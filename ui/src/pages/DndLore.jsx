import { useCallback, useEffect, useState } from 'react';
import { listLore } from '../api/lore';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

const splitParagraphs = (text) =>
  String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

const extractLeadAndBody = (content, summary) => {
  const paragraphs = splitParagraphs(content);
  const trimmedSummary = String(summary ?? '').trim();
  if (!trimmedSummary) {
    if (paragraphs.length === 0) {
      return ['', []];
    }
    return [paragraphs[0], paragraphs.slice(1)];
  }

  let removed = false;
  const body = paragraphs.filter((paragraph) => {
    if (!removed && paragraph.trim() === trimmedSummary) {
      removed = true;
      return false;
    }
    return true;
  });
  return [trimmedSummary, body];
};

const formatFieldLabel = (key) =>
  String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatFieldValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

export default function DndLore() {
  const [lore, setLore] = useState([]);
  const [loreLoading, setLoreLoading] = useState(false);
  const [loreError, setLoreError] = useState('');
  const [loreLoaded, setLoreLoaded] = useState(false);

  const fetchLore = useCallback(async () => {
    setLoreLoading(true);
    setLoreError('');
    try {
      const items = await listLore();
      setLore(Array.isArray(items) ? items : []);
      setLoreLoaded(true);
    } catch (err) {
      console.error(err);
      setLoreError(err?.message || String(err));
      setLoreLoaded(false);
    } finally {
      setLoreLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLore();
  }, [fetchLore]);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Lore</h1>
      <div className="dnd-lore">
        <div className="dnd-lore-controls">
          <button type="button" onClick={fetchLore} disabled={loreLoading}>
            {loreLoading ? 'Loading…' : 'Refresh'}
          </button>
          {loreLoading && <span>Loading lore…</span>}
        </div>
        {loreError && (
          <div className="warning">
            <div>Failed to load lore: {loreError}</div>
            <button type="button" onClick={fetchLore} disabled={loreLoading}>
              Try again
            </button>
          </div>
        )}
        {!loreLoading && !loreError && loreLoaded && lore.length === 0 && (
          <p>No lore entries found.</p>
        )}
        {lore.length > 0 && (
          <ul className="dnd-lore-list">
            {lore.map((item) => {
              const [lead, body] = extractLeadAndBody(item.content, item.summary);
              const title = item.title || item.path || 'Untitled Lore Entry';

              const aliasSource = Array.isArray(item.aliases)
                ? item.aliases.filter((alias) => alias && alias.trim().length > 0)
                : [];
              const aliasSet = new Set(aliasSource.map((alias) => alias.trim()));
              if (title) {
                aliasSet.delete(title.trim());
              }
              const aliases = Array.from(aliasSet);

              const tagList = Array.isArray(item.tags)
                ? Array.from(
                    new Set(
                      item.tags
                        .map((tag) => (tag ? String(tag).trim() : ''))
                        .filter((tag) => tag.length > 0),
                    ),
                  )
                : [];

              const fieldEntriesRaw =
                item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)
                  ? Object.entries(item.fields)
                  : [];
              const fieldEntries = fieldEntriesRaw
                .map(([key, value]) => [key, formatFieldValue(value)])
                .filter(([, value]) => value && value.length > 0);

              return (
                <li key={item.path || item.title} className="lore-card">
                  <div className="lore-header">
                    <h3 className="lore-title">{title}</h3>
                    {item.path && <span className="lore-path">{item.path}</span>}
                    {aliases.length > 0 && (
                      <div className="lore-aliases">
                        {aliases.map((alias) => (
                          <span key={alias} className="lore-chip">
                            {alias}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {lead && <p className="lore-summary">{lead}</p>}

                  {body.length > 0 && (
                    <div className="lore-body">
                      {body.map((paragraph, index) => (
                        <p key={`${item.path || item.title}-p-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  )}

                  {fieldEntries.length > 0 && (
                    <dl className="lore-fields">
                      {fieldEntries.map(([key, value]) => (
                        <div key={key} className="lore-field">
                          <dt>{formatFieldLabel(key)}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {tagList.length > 0 && (
                    <div className="lore-tags">
                      {tagList.map((tag) => (
                        <span key={tag} className="lore-chip lore-tag">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
