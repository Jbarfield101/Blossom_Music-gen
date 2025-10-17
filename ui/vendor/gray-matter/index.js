const FRONT_MATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

function matter(source) {
  const text = typeof source === 'string' ? source : '';
  const match = text.match(FRONT_MATTER_PATTERN);
  if (!match) {
    return {
      content: text,
      data: {},
      orig: text,
    };
  }
  const frontMatter = match[1] || '';
  const content = match[2] || '';
  const data = parseYaml(frontMatter);
  return {
    content,
    data,
    orig: text,
  };
}

matter.stringify = function stringify(content, data) {
  const yaml = stringifyYaml(data || {});
  const body = typeof content === 'string' ? content : '';
  const separator = body && !body.startsWith('\n') ? '\n' : '';
  return `---\n${yaml}\n---\n${separator}${body}`;
};

function parseYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  function peek() {
    let i = index;
    while (i < lines.length) {
      const raw = lines[i];
      if (raw.trim() === '' || raw.trim().startsWith('#')) {
        i += 1;
        continue;
      }
      const indent = raw.length - raw.replace(/^\s*/, '').length;
      const content = raw.trim();
      return { index: i, indent, raw, content };
    }
    return null;
  }

  function advance(to) {
    index = to + 1;
  }

  function parseBlock(expectedIndent) {
    const state = peek();
    if (!state) return undefined;
    if (state.indent < expectedIndent) {
      return undefined;
    }
    if (state.content.startsWith('- ')) {
      return parseSequence(expectedIndent);
    }
    return parseMapping(expectedIndent);
  }

  function parseSequence(expectedIndent) {
    const arr = [];
    while (true) {
      const state = peek();
      if (!state) break;
      if (state.indent < expectedIndent) break;
      if (!state.content.startsWith('- ')) break;
      advance(state.index);
      const itemSource = state.content.slice(2).trim();
      let item;
      if (!itemSource) {
        const nested = parseBlock(expectedIndent + 2);
        item = nested === undefined ? {} : nested;
      } else {
        const kv = splitKeyValue(itemSource);
        if (kv) {
          if (kv.value === '') {
            const nested = parseBlock(expectedIndent + 2);
            item = { [kv.key]: nested === undefined ? {} : nested };
          } else {
            item = { [kv.key]: parseScalar(kv.value) };
            const nested = parseMaybeNested(expectedIndent + 2);
            if (nested !== undefined) {
              if (isPlainObject(nested)) {
                Object.assign(item, nested);
              } else {
                item[kv.key] = nested;
              }
            }
          }
        } else {
          item = parseScalar(itemSource);
          const nested = parseMaybeNested(expectedIndent + 2);
          if (nested !== undefined) {
            item = nested;
          }
        }
      }
      arr.push(item);
    }
    return arr;
  }

  function parseMapping(expectedIndent) {
    const obj = {};
    while (true) {
      const state = peek();
      if (!state) break;
      if (state.indent < expectedIndent) break;
      if (state.content.startsWith('- ')) break;
      const kv = splitKeyValue(state.content);
      if (!kv) {
        advance(state.index);
        continue;
      }
      advance(state.index);
      if (kv.value === '') {
        const nested = parseBlock(expectedIndent + 2);
        obj[kv.key] = nested === undefined ? {} : nested;
      } else {
        obj[kv.key] = parseScalar(kv.value);
        const nested = parseMaybeNested(expectedIndent + 2);
        if (nested !== undefined) {
          if (isPlainObject(obj[kv.key]) && isPlainObject(nested)) {
            Object.assign(obj[kv.key], nested);
          } else {
            obj[kv.key] = nested;
          }
        }
      }
    }
    return obj;
  }

  function parseMaybeNested(expectedIndent) {
    const state = peek();
    if (!state) return undefined;
    if (state.indent < expectedIndent) return undefined;
    return parseBlock(expectedIndent);
  }

  function splitKeyValue(line) {
    const idx = line.indexOf(':');
    if (idx === -1) return null;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    return { key, value };
  }

  function parseScalar(value) {
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(',').map((part) => parseScalar(part.trim()));
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      return value.slice(1, -1);
    }
    if (/^(true|false)$/i.test(value)) {
      return /^true$/i.test(value);
    }
    if (/^(null|~)$/i.test(value)) {
      return null;
    }
    if (!Number.isNaN(Number(value))) {
      return Number(value);
    }
    return value;
  }

  const result = parseBlock(0);
  return result === undefined ? {} : result;
}

function stringifyYaml(data) {
  return stringifyValue(data, 0).trimEnd();
}

function stringifyValue(value, indent) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value
      .map((item) => {
        const rendered = stringifyValue(item, indent + 2);
        const pad = ' '.repeat(indent);
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const lines = rendered.split('\n');
          const [first, ...rest] = lines;
          const continuation = rest
            .map((line) => `${' '.repeat(indent + 2)}${line}`)
            .join('\n');
          return continuation
            ? `${pad}- ${first}\n${continuation}`
            : `${pad}- ${first}`;
        }
        if (rendered.includes('\n')) {
          const [first, ...rest] = rendered.split('\n');
          return `${pad}- ${first}\n${rest.map((line) => `${' '.repeat(indent + 2)}${line}`).join('\n')}`;
        }
        return `${pad}- ${rendered}`;
      })
      .join('\n');
  }
  if (isPlainObject(value)) {
    const entries = Object.keys(value).sort();
    if (entries.length === 0) {
      return '{}';
    }
    return entries
      .map((key) => {
        const rendered = stringifyValue(value[key], indent + 2);
        const pad = ' '.repeat(indent);
        if (Array.isArray(value[key])) {
          if (!value[key].length) {
            return `${pad}${key}: []`;
          }
          const lines = rendered.split('\n').map((line) => line.trimStart());
          const indented = lines
            .map((line) => `${' '.repeat(indent + 2)}${line}`)
            .join('\n');
          return `${pad}${key}:\n${indented}`;
        }
        if (typeof value[key] === 'object' && value[key] !== null) {
          const lines = rendered.split('\n');
          const [first, ...rest] = lines;
          const continuation = rest
            .map((line) => `${' '.repeat(indent + 2)}${line}`)
            .join('\n');
          return continuation
            ? `${pad}${key}: ${first}\n${continuation}`
            : `${pad}${key}: ${first}`;
        }
        return `${pad}${key}: ${rendered}`;
      })
      .join('\n');
  }
  return formatScalar(value);
}

function formatScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') {
    return formatScalar(String(value));
  }
  if (value === '') return "''";
  if (/[:#\-?&*!|>'\"@`{}\[\]\r\n]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export { matter };
export default matter;
