import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const VaultEventContext = createContext({ versions: {}, lastEvent: null });

function normalizeKey(input) {
  if (input === '__all') return '__all';
  const value = String(input || '').trim();
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return '';
  if (segments.length === 1) return segments[0];
  return `${segments[0]}/${segments[1]}`;
}

export function VaultEventProvider({ children }) {
  const [versions, setVersions] = useState({});
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    let unlisten = null;
    let cancelled = false;

    const attach = async () => {
      try {
        if (!isTauri()) return;
        const stop = await listen('dnd::vault-changed', (event) => {
          const payload = event?.payload || {};
          const paths = Array.isArray(payload.paths) ? payload.paths : [];
          setVersions((prev) => {
            const next = { ...prev };
            next.__all = (next.__all || 0) + 1;
            for (const rawPath of paths) {
              const key = normalizeKey(rawPath);
              if (!key) continue;
              next[key] = (next[key] || 0) + 1;
              const [first] = key.split('/');
              if (first && first !== key) {
                next[first] = (next[first] || 0) + 1;
              }
            }
            return next;
          });
          setLastEvent(payload);
        });
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      } catch (err) {
        console.warn('Failed to listen for D&D vault updates', err);
      }
    };

    attach();

    return () => {
      cancelled = true;
      if (unlisten) {
        try {
          unlisten();
        } catch (err) {
          console.warn('Failed to clean up vault watcher listener', err);
        }
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      versions,
      lastEvent,
    }),
    [versions, lastEvent],
  );

  return (
    <VaultEventContext.Provider value={value}>
      {children}
    </VaultEventContext.Provider>
  );
}

export function useVaultVersion(keys) {
  const { versions } = useContext(VaultEventContext);
  const list = Array.isArray(keys) ? keys : [keys];
  if (!list.length) {
    return String(versions.__all || 0);
  }
  const token = list
    .map((key) => normalizeKey(key))
    .filter(Boolean)
    .map((key) => versions[key] || 0)
    .join('|');
  return token || String(versions.__all || 0);
}

export function useLastVaultEvent() {
  const { lastEvent } = useContext(VaultEventContext);
  return lastEvent;
}
