import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig } from '../api/config';
import { listInbox, readInbox } from '../api/inbox';
import { listDir } from '../api/dir';
import { readFileBytes } from '../api/files';
import { createMonster } from '../api/monsters';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';

const DEFAULT_MONSTERS = 'D\\\\Documents\\\\DreadHaven\\\\20_DM\\\\Monsters'.replace(/\\\\/g, '\\\\');
const DEFAULT_PORTRAITS = 'D\\\\Documents\\\\DreadHaven\\\\30_Assets\\\\Images\\\\Monster_Portraits'.replace(/\\\\/g, '\\\\');
const MONSTER_TEMPLATE = 'D\\\\Documents\\\\DreadHaven\\\\_Templates\\\\Monster Template + Universal (D&D 5e Statblock).md';
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function formatDate(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
}

function formatRelative(ms) {
  const now = Date.now();
  const diff = Math.max(0, now - Number(ms || 0));
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export default function DndDmMonsters() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usingPath, setUsingPath] = useState('');
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [types, setTypes] = useState({});
  const [crs, setCrs] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [portraitIndex, setPortraitIndex] = useState({});
  const [portraitUrls, setPortraitUrls] = useState({});
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getConfig('vaultPath');
      const base = (typeof vault === 'string' && vault) ? `${vault}\\\\20_DM\\\\Monsters`.replace(/\\\\/g, '\\\\') : '';
      if (base) {
        const list = await listInbox(base);
        setUsingPath(base);
        setItems(Array.isArray(list) ? list : []);
        return;
      }
      throw new Error('no vault');
    } catch (e1) {
      try {
        const fallback = 'D:\\Documents\\DreadHaven\\20_DM\\Monsters';
        const list = await listInbox(fallback);
        setUsingPath(fallback);
        setItems(Array.isArray(list) ? list : []);
      } catch (e2) {
        console.error(e2);
        setError(e2?.message || String(e2));
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [activePath]);

  const openCreateModal = () => {
    if (creating) return;
    setNewName('');
    setCreateError('');
    setShowCreate(true);
  };

  const dismissCreateModal = () => {
    setShowCreate(false);
    setNewName('');
    setCreateError('');
  };

  const handleCreateSubmit = async (event) => {
    event.preventDefault();
    if (creating) return;
    const name = newName.trim();
    if (!name) {
      setCreateError('Please enter a monster name.');
      return;
    }
    try {
      setCreating(true);
      setCreateError('');
      await createMonster(name, MONSTER_TEMPLATE);
      dismissCreateModal();
      await fetchItems();
    } catch (e) {
      setCreateError(e?.message || 'Failed to create monster.');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Build portrait index from Assets folder
  useEffect(() => {
    (async () => {
      try {
        const vault = await getConfig('vaultPath');
        const base = (typeof vault === 'string' && vault)
          ? `${vault}\\\\30_Assets\\\\Images\\\\Monster_Portraits`.replace(/\\\\/g, '\\\\')
          : DEFAULT_PORTRAITS;
        const entries = await listDir(base);
        const idx = {};
        const normalize = (s) => String(s || '')
          .replace(/\.[^.]+$/, '')
          .replace(/^portrait[_\-\s]+/i, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        for (const e of entries) {
          if (e.is_dir) continue;
          if (!IMG_RE.test(e.name)) continue;
          const key = normalize(e.name);
          if (key) idx[key] = e.path;
        }
        setPortraitIndex(idx);
      } catch (e) {
        setPortraitIndex({});
      }
    })();
  }, []);

  useEffect(() => {
    if (!activePath) { setActiveContent(''); return; }
    (async () => {
      try {
        const text = await readInbox(activePath);
        setActiveContent(text || '');
      } catch (e) {
        setActiveContent('Failed to load file.');
      }
    })();
  }, [activePath]);

  // Load portrait thumbnails for listed monsters
  useEffect(() => {
    let cancelled = false;
    const normalize = (s) => String(s || '')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    (async () => {
      for (const it of items) {
        if (portraitUrls[it.path]) continue; // already has URL
        const key = normalize((it.title || it.name || ''));
        const imgPath = portraitIndex[key];
        if (!imgPath) continue;
        try {
          const bytes = await readFileBytes(imgPath);
          if (cancelled) return;
          const ext = imgPath.split('.').pop().toLowerCase();
          const mime = ext === 'png' ? 'image/png'
            : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : ext === 'bmp' ? 'image/bmp'
            : ext === 'svg' ? 'image/svg+xml'
            : 'application/octet-stream';
          const blob = new Blob([new Uint8Array(bytes)], { type: mime });
          const url = URL.createObjectURL(blob);
          setPortraitUrls((prev) => ({ ...prev, [it.path]: url }));
        } catch (e) {
          // ignore
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items, portraitIndex]);

  const selected = useMemo(() => items.find((i) => i.path === activePath), [items, activePath]);

  const sanitizeType = (raw) => {
    let s = String(raw || '').trim();
    if (!s) return '';
    // Strip common markdown emphasis/backticks
    s = s.replace(/[\*_`]+/g, '');
    // Collapse whitespace and trim punctuation
    s = s.replace(/\s+/g, ' ').replace(/^[:\-–—\s]+|[:\-–—\s]+$/g, '');
    // Title-case words for nicer display
    s = s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
    return s;
  };

  // Extract monster type from frontmatter or simple `Type: ...` line, then sanitize
  const extractMonsterType = (text) => {
    try {
      const src = String(text || '');
      // YAML frontmatter --- ... ---
      const fm = src.match(/^---\n([\s\S]*?)\n---/);
      if (fm) {
        const body = fm[1];
        const line = body.split(/\r?\n/).find((l) => /^\s*type\s*:/i.test(l));
        if (line) {
          return sanitizeType(line.split(':').slice(1).join(':').trim());
        }
      }
      // Fallback: find a line `Type: something`
      const m = src.match(/\bType\s*:\s*([^\n\r]+)/i);
      if (m) return sanitizeType(m[1].trim());
    } catch {}
    return '';
  };

  // Extract CR as a number or fraction (e.g., 25 or 1/2)
  const extractMonsterCr = (text) => {
    try {
      const src = String(text || '');
      const numberFrom = (s) => {
        const mm = String(s || '').match(/([0-9]+(?:\/[0-9]+)?)/);
        return mm ? mm[1] : '';
      };
      const fm = src.match(/^---\n([\s\S]*?)\n---/);
      if (fm) {
        const body = fm[1];
        const line = body.split(/\r?\n/).find((l) => /^(\s*(cr|challenge)\s*:)/i.test(l));
        if (line) {
          const val = line.split(':').slice(1).join(':').trim();
          const n = numberFrom(val);
          if (n) return n;
        }
      }
      const m2 = src.match(/(^|\n)[^\n]*\bCR\b[^\n]*?([0-9]+(?:\/[0-9]+)?)/i);
      if (m2) return m2[2];
    } catch {}
    return '';
  };

  // Load types and CR for cards lazily when items change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const it of items) {
        if (types[it.path] !== undefined && crs[it.path] !== undefined) continue;
        try {
          const content = await readInbox(it.path);
          if (cancelled) return;
          const t = extractMonsterType(content);
          const crv = extractMonsterCr(content);
          setTypes((prev) => ({ ...prev, [it.path]: t || '' }));
          setCrs((prev) => ({ ...prev, [it.path]: crv || '' }));
        } catch {
          // ignore
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items]);

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Monsters</h1>
      <div className="pantheon-controls">
        <button type="button" onClick={fetchItems} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button type="button" onClick={openCreateModal} disabled={creating}>
          Add Monster
        </button>
        {usingPath && <span className="muted">Folder: {usingPath}</span>}
        {error && <span className="error">{error}</span>}
      </div>
      <section className="pantheon-grid">
        {items.map((item) => (
          <button
            key={item.path}
            className={`pantheon-card`}
            onClick={() => { setActivePath(item.path); setModalOpen(true); }}
            title={item.path}
          >
            {portraitUrls[item.path] ? (
              <img src={portraitUrls[item.path]} alt={item.title || item.name} className="monster-portrait" />
            ) : (
              <div className="monster-portrait placeholder">?</div>
            )}
            <div className="pantheon-card-title">{item.title || item.name}</div>
            <div className="pantheon-card-meta">Type: {types[item.path] || '-'}</div>
            <div className="pantheon-card-meta">CR: {crs[item.path] || '-'}</div>
          </button>
        ))}
        {!loading && items.length === 0 && (
          <div className="muted">No monsters found in this folder.</div>
        )}
      </section>

      {modalOpen && (
        <div className="lightbox" onClick={() => { setModalOpen(false); }}>
          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            {selected ? (
              <>
                <header className="inbox-reader-header">
                  <h2 className="inbox-reader-title">{selected.title || selected.name}</h2>
                  <div className="inbox-reader-meta">
                    <span>{selected.name}</span>
                    <span>·</span>
                    <time>{formatDate(selected.modified_ms)}</time>
                  </div>
                </header>
                <article className="inbox-reader-body">
                  <MonsterDetails content={activeContent} fileName={selected.name} inferredType={types[selected.path]} />
                  <h3 className="section-title" style={{ marginTop: '1rem' }}>Original Notes</h3>
                  {/\.(md|mdx|markdown)$/i.test(selected.name || '') ? (
                    renderMarkdown(activeContent || 'Loading…')
                  ) : (
                    <pre className="inbox-reader-content">{activeContent || 'Loading…'}</pre>
                  )}
                </article>
              </>
            ) : (
              <div className="muted">Loading…</div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div
          className="lightbox"
          onClick={() => {
            if (!creating) dismissCreateModal();
          }}
        >
          <div
            className="lightbox-panel monster-create-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>New Monster</h2>
            <form className="monster-create-form" onSubmit={handleCreateSubmit}>
              <label htmlFor="monster-name">
                Monster Name
                <input
                  id="monster-name"
                  type="text"
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value);
                    if (createError) setCreateError('');
                  }}
                  disabled={creating}
                  autoFocus
                />
              </label>
              {createError && <div className="error">{createError}</div>}
              <div className="monster-create-actions">
                <button
                  type="button"
                  onClick={() => {
                    if (!creating) dismissCreateModal();
                  }}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function MonsterDetails({ content, fileName, inferredType }) {
  const nameFromFile = String(fileName || '').replace(/\.[^.]+$/, '');
  // Local copy to avoid referencing outer component scope
  const sanitizeType = (raw) => {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/[\*_`]+/g, '');
    // Collapse whitespace and trim common punctuation (colon, hyphen, en/em dash)
    s = s.replace(/\s+/g, ' ').replace(/^[:\-–—\s]+|[:\-–—\s]+$/g, '');
    // Title-case words for nicer display
    s = s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
    return s;
  };
  const parseFrontmatter = (src) => {
    const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return [{}, src];
    const body = m[2] || '';
    const fmLines = m[1].split(/\r?\n/);
    const obj = {};
    for (const line of fmLines) {
      const mm = line.match(/^\s*([A-Za-z0-9_ -]+)\s*:\s*(.*)$/);
      if (mm) {
        const k = mm[1].trim().toLowerCase().replace(/\s+/g, '_');
        const v = mm[2].trim();
        obj[k] = v;
      }
    }
    return [obj, body];
  };

  const extractKV = (src) => {
    const get = (re) => {
      const mm = src.match(re);
      return mm ? mm[1].trim() : '';
    };
    const kv = {
      type: get(/\bType\s*:\s*([^\n\r]+)/i),
      cr: get(/\b(CR|Challenge(?:\s*Rating)?)\s*:\s*([^\n\r]+)/i) || get(/\bCR\s*([0-9/]+)\b/i),
      alignment: get(/\bAlignment\s*:\s*([^\n\r]+)/i),
      size: get(/\bSize\s*:\s*([^\n\r]+)/i),
      ac: get(/\b(Armor\s*Class|AC)\s*:?\s*([^\n\r]+)/i),
      hp: get(/\b(Hit\s*Points|HP)\s*:?\s*([^\n\r]+)/i),
      speed: get(/\bSpeed\s*:?\s*([^\n\r]+)/i),
      senses: get(/\bSenses\s*:?\s*([^\n\r]+)/i),
      languages: get(/\bLanguages\s*:?\s*([^\n\r]+)/i),
      skills: get(/\bSkills\s*:?\s*([^\n\r]+)/i),
      saves: get(/\b(Saving\s*Throws|Saves)\s*:?\s*([^\n\r]+)/i),
      dmg_res: get(/\bDamage\s*Resistances\s*:?\s*([^\n\r]+)/i),
      dmg_imm: get(/\bDamage\s*Immunities\s*:?\s*([^\n\r]+)/i),
      dmg_vuln: get(/\bDamage\s*Vulnerabilities\s*:?\s*([^\n\r]+)/i),
      cond_imm: get(/\bCondition\s*Immunities\s*:?\s*([^\n\r]+)/i),
    };
    const abil = {
      STR: get(/\bSTR\s*(\d{1,2})/i),
      DEX: get(/\bDEX\s*(\d{1,2})/i),
      CON: get(/\bCON\s*(\d{1,2})/i),
      INT: get(/\bINT\s*(\d{1,2})/i),
      WIS: get(/\bWIS\s*(\d{1,2})/i),
      CHA: get(/\bCHA\s*(\d{1,2})/i),
    };
    return [kv, abil];
  };

  const [fm, body] = parseFrontmatter(String(content || ''));
  const [kv, abil] = extractKV(String(content || ''));
  const title = fm.title || nameFromFile;
  const type = sanitizeType(fm.type || kv.type || inferredType || '');
  const normalizeCr = (val, fullSrc) => {
    const s = String(val || '');
    const m = s.match(/([0-9]+(?:\/[0-9]+)?)/);
    if (m) return m[1];
    const body = String(fullSrc || '');
    const m2 = body.match(/(^|\n)[^\n]*\bCR\b[^\n]*?([0-9]+(?:\/[0-9]+)?)/i);
    if (m2) return m2[2];
    return '';
  };
  const cr = normalizeCr(fm.cr || fm.challenge || kv.cr || '', content);
  const alignment = fm.alignment || kv.alignment || '';
  const size = fm.size || kv.size || '';
  const ac = fm.ac || fm.armor_class || kv.ac || '';
  const hp = fm.hp || fm.hit_points || kv.hp || '';
  const speed = fm.speed || kv.speed || '';
  const senses = fm.senses || kv.senses || '';
  const languages = fm.languages || kv.languages || '';
  const skills = fm.skills || kv.skills || '';
  const saves = fm.saves || fm.saving_throws || kv.saves || '';
  const dmg_res = fm.damage_resistances || kv.dmg_res || '';
  const dmg_imm = fm.damage_immunities || kv.dmg_imm || '';
  const dmg_vuln = fm.damage_vulnerabilities || kv.dmg_vuln || '';
  const cond_imm = fm.condition_immunities || kv.cond_imm || '';

  const stat = (s) => {
    const n = parseInt(String(s || ''), 10);
    if (Number.isNaN(n)) return null;
    const mod = Math.floor((n - 10) / 2);
    const sign = mod >= 0 ? '+' : '';
    return { n, mod: `${sign}${mod}` };
  };

  const stats = {
    STR: stat(fm.str || fm.STR || abil.STR),
    DEX: stat(fm.dex || fm.DEX || abil.DEX),
    CON: stat(fm.con || fm.CON || abil.CON),
    INT: stat(fm.int || fm.INT || abil.INT),
    WIS: stat(fm.wis || fm.WIS || abil.WIS),
    CHA: stat(fm.cha || fm.CHA || abil.CHA),
  };

  return (
    <div className="monster-details">
      <header className="monster-header">
        <h2 className="monster-title">{title}</h2>
        <div className="monster-chips">
          {type && <span className="chip">{type}</span>}
          {cr && <span className="chip">CR {cr}</span>}
          {alignment && <span className="chip">{alignment}</span>}
          {size && <span className="chip">{size}</span>}
        </div>
      </header>

      {(ac || hp || speed) && (
        <div className="monster-basics">
          {ac && <div><strong>AC</strong><div>{ac}</div></div>}
          {hp && <div><strong>HP</strong><div>{hp}</div></div>}
          {speed && <div><strong>Speed</strong><div>{speed}</div></div>}
        </div>
      )}

      {(stats.STR || stats.DEX || stats.CON || stats.INT || stats.WIS || stats.CHA) && (
        <div className="ability-grid">
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} className="ability">
              <div className="label">{k}</div>
              <div className="score">{v ? v.n : '—'} <span className="mod">{v ? v.mod : ''}</span></div>
            </div>
          ))}
        </div>
      )}

      <dl className="monster-kv">
        {skills && <div><dt>Skills</dt><dd>{skills}</dd></div>}
        {saves && <div><dt>Saving Throws</dt><dd>{saves}</dd></div>}
        {senses && <div><dt>Senses</dt><dd>{senses}</dd></div>}
        {languages && <div><dt>Languages</dt><dd>{languages}</dd></div>}
        {dmg_res && <div><dt>Resistances</dt><dd>{dmg_res}</dd></div>}
        {dmg_imm && <div><dt>Immunities</dt><dd>{dmg_imm}</dd></div>}
        {dmg_vuln && <div><dt>Vulnerabilities</dt><dd>{dmg_vuln}</dd></div>}
        {cond_imm && <div><dt>Condition Immunities</dt><dd>{cond_imm}</dd></div>}
      </dl>

      <h3 className="section-title">Full Notes</h3>
      <div>{renderMarkdown(body || content || '')}</div>
    </div>
  );
}
