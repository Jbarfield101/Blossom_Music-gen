/*
 * Minimal gray-matter compatible shim used in the offline test environment.
 *
 * The real project depends on the upstream `gray-matter` and `js-yaml`
 * packages.  Network restrictions in the kata container prevent us from
 * installing them, so this module implements the subset of functionality we
 * require: parsing and serialising YAML front matter with indentation-based
 * nesting, lists and multi-line strings.  The API mirrors `gray-matter` enough
 * for the vault adapter tests to exercise the same control-flow as production
 * code.
 */

const NEWLINE = /\r?\n/;

function countIndent(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') {
    i += 1;
  }
  return i;
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseScalar(token) {
  const trimmed = token.trim();
  if (trimmed === '' || trimmed === '~' || trimmed.toLowerCase() === 'null') return '';
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;
  if (/^[-+]?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return stripQuotes(trimmed);
}

function parseInlineList(token) {
  const inner = token.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => parseScalar(item));
}

function nextSignificant(lines, index) {
  let cursor = index;
  while (cursor < lines.length) {
    const trimmed = lines[cursor].trim();
    if (trimmed && !trimmed.startsWith('#')) return cursor;
    cursor += 1;
  }
  return null;
}

function parseBlockScalar(lines, index, indent, fold) {
  const parts = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    const trimmed = line.trim();
    const currentIndent = countIndent(line);
    if (!trimmed) {
      parts.push('');
      cursor += 1;
      continue;
    }
    if (currentIndent < indent) break;
    const slice = currentIndent >= indent ? line.slice(indent) : trimmed;
    parts.push(slice);
    cursor += 1;
  }
  if (fold) {
    return [parts.map((segment) => segment.trim()).filter(Boolean).join(' '), cursor];
  }
  return [parts.join('\n').replace(/\n+$/, ''), cursor];
}

function parseSequence(lines, index, indent) {
  const items = [];
  let cursor = index;
  while (cursor < lines.length) {
    const raw = lines[cursor];
    const trimmed = raw.trim();
    const currentIndent = countIndent(raw);
    if (!trimmed || trimmed.startsWith('#')) {
      cursor += 1;
      continue;
    }
    if (currentIndent < indent || !trimmed.startsWith('-')) break;
    const remainder = trimmed.slice(1).trim();
    if (!remainder) {
      cursor += 1;
      const nextIdx = nextSignificant(lines, cursor);
      if (nextIdx == null) {
        items.push('');
        cursor = lines.length;
        break;
      }
      const nextLine = lines[nextIdx];
      const nextIndent = countIndent(nextLine);
      if (nextIndent <= currentIndent) {
        items.push('');
        cursor = nextIdx;
        continue;
      }
      if (nextLine.trim().startsWith('-')) {
        const [seq, newIdx] = parseSequence(lines, nextIdx, nextIndent);
        items.push(seq);
        cursor = newIdx;
      } else {
        const [map, newIdx] = parseMapping(lines, nextIdx, nextIndent);
        items.push(map);
        cursor = newIdx;
      }
    } else if (remainder === '|' || remainder === '>') {
      cursor += 1;
      const [value, newIdx] = parseBlockScalar(lines, cursor, currentIndent + 2, remainder === '>');
      items.push(value);
      cursor = newIdx;
    } else if (remainder.startsWith('[') && remainder.endsWith(']')) {
      items.push(parseInlineList(remainder));
      cursor += 1;
    } else if (remainder.includes(':')) {
      const [key, valueToken] = remainder.split(/:(.+)/);
      const keyTrim = key.trim();
      const valueTrim = (valueToken ?? '').trim();
      if (!valueTrim) {
        cursor += 1;
        const nextIdx = nextSignificant(lines, cursor);
        if (nextIdx == null) {
          items.push({ [keyTrim]: '' });
          cursor = lines.length;
        } else {
          const nextLine = lines[nextIdx];
          const nextIndent = countIndent(nextLine);
          if (nextIndent <= currentIndent) {
            items.push({ [keyTrim]: '' });
            cursor = nextIdx;
          } else if (nextLine.trim().startsWith('-')) {
            const [seq, newIdx] = parseSequence(lines, nextIdx, nextIndent);
            items.push({ [keyTrim]: seq });
            cursor = newIdx;
          } else {
            const [map, newIdx] = parseMapping(lines, nextIdx, nextIndent);
            items.push({ [keyTrim]: map });
            cursor = newIdx;
          }
        }
      } else {
        items.push({ [keyTrim]: parseScalar(valueTrim) });
        cursor += 1;
      }
    } else {
      items.push(parseScalar(remainder));
      cursor += 1;
    }
  }
  return [items, cursor];
}

function parseMapping(lines, index, indent) {
  const result = {};
  let cursor = index;
  while (cursor < lines.length) {
    const raw = lines[cursor];
    const trimmed = raw.trim();
    const currentIndent = countIndent(raw);
    if (!trimmed || trimmed.startsWith('#')) {
      cursor += 1;
      continue;
    }
    if (currentIndent < indent) break;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Malformed YAML line: ${raw}`);
    }
    const key = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (!remainder) {
      cursor += 1;
      const nextIdx = nextSignificant(lines, cursor);
      if (nextIdx == null) {
        result[key] = '';
        cursor = lines.length;
        continue;
      }
      const nextLine = lines[nextIdx];
      const nextIndent = countIndent(nextLine);
      if (nextIndent <= currentIndent) {
        result[key] = '';
        cursor = nextIdx;
        continue;
      }
      if (nextLine.trim().startsWith('-')) {
        const [seq, newIdx] = parseSequence(lines, nextIdx, nextIndent);
        result[key] = seq;
        cursor = newIdx;
      } else {
        const [map, newIdx] = parseMapping(lines, nextIdx, nextIndent);
        result[key] = map;
        cursor = newIdx;
      }
    } else if (remainder === '|' || remainder === '>') {
      cursor += 1;
      const [value, newIdx] = parseBlockScalar(lines, cursor, currentIndent + 2, remainder === '>');
      result[key] = value;
      cursor = newIdx;
    } else if (remainder.startsWith('[') && remainder.endsWith(']')) {
      result[key] = parseInlineList(remainder);
      cursor += 1;
    } else {
      result[key] = parseScalar(remainder);
      cursor += 1;
    }
  }
  return [result, cursor];
}

function dumpScalar(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '""';
  const text = String(value);
  if (text.includes('\n')) {
    return `|\n${text}`;
  }
  if (text === '') return '""';
  if (/[:#\-{}\[\]]/.test(text)) {
    return `"${text}"`;
  }
  return text;
}

function dumpList(values, indent) {
  const lines = [];
  const pad = ' '.repeat(indent);
  for (const entry of values) {
    if (Array.isArray(entry)) {
      lines.push(`${pad}-`);
      lines.push(...dumpList(entry, indent + 2));
    } else if (entry && typeof entry === 'object') {
      lines.push(`${pad}-`);
      lines.push(...dumpMapping(entry, indent + 2));
    } else {
      lines.push(`${pad}- ${dumpScalar(entry)}`);
    }
  }
  return lines;
}

function dumpMapping(mapping, indent) {
  const lines = [];
  const pad = ' '.repeat(indent);
  for (const key of Object.keys(mapping)) {
    const value = mapping[key];
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(...dumpList(value, indent + 2));
      }
    } else if (value && typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(...dumpMapping(value, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${dumpScalar(value)}`);
    }
  }
  return lines;
}

function parseYaml(src) {
  const lines = src.replace(/\t/g, '  ').split(NEWLINE);
  const [data] = parseMapping(lines, 0, 0);
  return data;
}

function dumpYaml(data) {
  return `${dumpMapping(data, 0).join('\n')}\n`;
}

function splitFrontMatter(src) {
  if (!src.startsWith('---')) {
    return null;
  }
  const parts = src.split(/^---\s*\r?\n/m);
  if (parts.length < 2) return null;
  const rest = parts.slice(1).join('---\n');
  const endIdx = rest.indexOf('\n---');
  if (endIdx === -1) return null;
  const yaml = rest.slice(0, endIdx).replace(/\r?\n$/, '');
  const body = rest.slice(endIdx + 4).replace(/^\s*\r?\n/, '');
  return { yaml, body };
}

function matter(input) {
  const text = typeof input === 'string' ? input : '';
  const block = splitFrontMatter(text);
  if (!block) {
    return { data: {}, content: text, excerpt: '' };
  }
  let data = {};
  try {
    data = parseYaml(block.yaml);
  } catch (error) {
    const err = new Error('Failed to parse front matter');
    err.cause = error;
    throw err;
  }
  return { data, content: block.body, excerpt: '' };
}

matter.stringify = function stringify(body, data) {
  const payload = typeof data === 'object' && data ? data : {};
  const yaml = dumpYaml(payload);
  const content = typeof body === 'string' ? body : '';
  return `---\n${yaml}---\n${content.startsWith('\n') ? content.slice(1) : content}`;
};

export default matter;
