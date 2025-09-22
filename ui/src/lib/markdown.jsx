import React, { useEffect, useState } from 'react';
import { getCachedVaultAttachment, resolveVaultAttachment } from './vaultAttachments.js';

function VaultAttachmentImage({ resource, alt }) {
  const [src, setSrc] = useState(() => getCachedVaultAttachment(resource));
  const [status, setStatus] = useState(() => (getCachedVaultAttachment(resource) ? 'ready' : 'idle'));

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedVaultAttachment(resource);
    if (cached) {
      setSrc(cached);
      setStatus('ready');
      return () => {
        cancelled = true;
      };
    }

    setSrc('');
    setStatus('loading');
    (async () => {
      try {
        const url = await resolveVaultAttachment(resource);
        if (cancelled) return;
        setSrc(url);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.warn('Failed to resolve vault attachment', resource, err);
        setSrc('');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resource]);

  const altText = String(alt || '').trim() || resource.split(/[\\/]/).pop() || resource;
  const props = {
    className: 'md-img',
    alt: altText,
    'data-resource': resource,
  };
  if (src) {
    props.src = src;
  } else if (status === 'loading') {
    props['data-loading'] = 'true';
  }
  if (status === 'error') {
    props['data-error'] = 'true';
  }

  return <img {...props} />;
}

function wrapHashtagsInNodes(nodes, keyBase) {
  const out = [];
  let chipCounter = 0;
  nodes.forEach((node) => {
    if (typeof node !== 'string') {
      out.push(node);
      return;
    }
    const tagRe = /(^|[\s>({\["'`])#([A-Za-z0-9/_-]+)/g;
    let lastIndex = 0;
    let match;
    while ((match = tagRe.exec(node))) {
      const tagStart = match.index + match[1].length;
      const label = `#${match[2]}`;
      if (tagStart > lastIndex) {
        out.push(node.slice(lastIndex, tagStart));
      }
      out.push(
        <span key={`chip-${keyBase}-${chipCounter}`} className="chip">
          {label}
        </span>
      );
      chipCounter += 1;
      lastIndex = tagStart + label.length;
    }
    if (lastIndex < node.length) {
      out.push(node.slice(lastIndex));
    }
  });
  return out;
}

function parseInline(text) {
  // Handle code spans first
  const parts = [];
  let remaining = text;
  while (true) {
    const idx = remaining.indexOf('`');
    if (idx === -1) break;
    const end = remaining.indexOf('`', idx + 1);
    if (end === -1) break;
    if (idx > 0) parts.push(remaining.slice(0, idx));
    const code = remaining.slice(idx + 1, end);
    parts.push(React.createElement('code', { key: parts.length }, code));
    remaining = remaining.slice(end + 1);
  }
  if (remaining) parts.push(remaining);

  // Then bold and italics and links within non-code strings only
  const mapText = (node, i) => {
    if (typeof node !== 'string') return node;

    // Embedded vault images ![[resource|alt]]
    const vaultRe = /!\[\[([^|\]]+?)(?:\|([^\]]+))?\]\]/g;
    let vaultIndex = 0;
    const vaultOut = [];
    let vm;
    while ((vm = vaultRe.exec(node))) {
      if (vm.index > vaultIndex) vaultOut.push(node.slice(vaultIndex, vm.index));
      const target = (vm[1] || '').trim();
      const alias = (vm[2] || '').trim();
      if (target) {
        vaultOut.push(
          <VaultAttachmentImage
            key={`vimg-${i}-${vaultOut.length}`}
            resource={target}
            alt={alias}
          />
        );
      } else {
        vaultOut.push(vm[0]);
      }
      vaultIndex = vm.index + vm[0].length;
    }
    if (vaultIndex < node.length) vaultOut.push(node.slice(vaultIndex));

    // Images ![alt](src)
    const imgRe = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    const imgOut = [];
    vaultOut.forEach((piece) => {
      if (typeof piece !== 'string') {
        imgOut.push(piece);
        return;
      }
      let lastIndex = 0;
      let im;
      imgRe.lastIndex = 0;
      while ((im = imgRe.exec(piece))) {
        if (im.index > lastIndex) imgOut.push(piece.slice(lastIndex, im.index));
        const [_, alt, src] = im;
        imgOut.push(
          <img key={`img-${i}-${imgOut.length}`} src={src} alt={alt} className="md-img" />
        );
        lastIndex = im.index + im[0].length;
      }
      if (lastIndex < piece.length) imgOut.push(piece.slice(lastIndex));
    });

    // Links [text](url) inside the remaining text pieces
    const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let linkIndex = 0;
    const out = [];
    imgOut.forEach((piece, idx) => {
      if (typeof piece !== 'string') {
        out.push(piece);
        return;
      }
      linkIndex = 0;
      let m;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(piece))) {
        if (m.index > linkIndex) out.push(piece.slice(linkIndex, m.index));
        const [_, label, href] = m;
        out.push(
          <a key={`lnk-${i}-${out.length}`} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        );
        linkIndex = m.index + m[0].length;
      }
      if (linkIndex < piece.length) out.push(piece.slice(linkIndex));
    });

    // Bold **text** then italics *text*
    const mapBoldItalics = (n, j) => {
      if (typeof n !== 'string') return n;
      // Bold
      const bRe = /\*\*([^*]+)\*\*/g;
      let bi = 0;
      const bOut = [];
      let bm;
      while ((bm = bRe.exec(n))) {
        if (bm.index > bi) bOut.push(n.slice(bi, bm.index));
        bOut.push(<strong key={`b-${j}-${bOut.length}`}>{bm[1]}</strong>);
        bi = bm.index + bm[0].length;
      }
      if (bi < n.length) bOut.push(n.slice(bi));

      // Italics (single *)
      const iOut = [];
      for (let k = 0; k < bOut.length; k++) {
        const seg = bOut[k];
        if (typeof seg !== 'string') {
          iOut.push(seg);
          continue;
        }
        const iRe = /\*([^*]+)\*/g;
        let ii = 0;
        let im;
        while ((im = iRe.exec(seg))) {
          if (im.index > ii) iOut.push(seg.slice(ii, im.index));
          iOut.push(<em key={`i-${j}-${iOut.length}`}>{im[1]}</em>);
          ii = im.index + im[0].length;
        }
        if (ii < seg.length) iOut.push(seg.slice(ii));
      }
      return iOut;
    };

    const emphasized = out.flatMap(mapBoldItalics);
    return wrapHashtagsInNodes(emphasized, `tag-${i}`);
  };

  return parts.flatMap(mapText);
}

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Code fence
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const lang = (fence[1] || '').trim();
      i++;
      const buf = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      // skip closing fence
      if (i < lines.length && /^```\s*$/.test(lines[i])) i++;
      blocks.push(
        <pre className="md-code" key={`pre-${blocks.length}`}>
          <code data-lang={lang}>{buf.join('\n')}</code>
        </pre>
      );
      continue;
    }
    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length);
      blocks.push(React.createElement(`h${level}`, { key: `h-${blocks.length}` }, parseInline(h[2])));
      i++;
      continue;
    }
    // List (unordered)
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push(<li key={`li-${items.length}`}>{parseInline(text)}</li>);
        i++;
      }
      blocks.push(<ul key={`ul-${blocks.length}`}>{items}</ul>);
      continue;
    }
    // Simple table: header | header\n|---|---|\nrows
    const isTableHeader = line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]);
    if (isTableHeader) {
      const headerCells = line.split('|').map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
      i += 2; // skip header and separator
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() && !/^```/.test(lines[i])) {
        const cells = lines[i]
          .split('|')
          .map((c) => c.trim())
          .filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
        rows.push(cells);
        i++;
      }
      blocks.push(
        <table className="md-table" key={`tbl-${blocks.length}`}>
          <thead>
            <tr>{headerCells.map((h, idx) => (<th key={`th-${idx}`}>{parseInline(h)}</th>))}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={`tr-${ri}`}>{r.map((c, ci) => (<td key={`td-${ri}-${ci}`}>{parseInline(c)}</td>))}</tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }
    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }
    // Paragraph: accumulate until blank line or block start
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={`p-${blocks.length}`}>{parseInline(para.join(' '))}</p>);
  }

  return <div className="markdown-body">{blocks}</div>;
}

export default renderMarkdown;
