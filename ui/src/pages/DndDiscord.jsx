import BackButton from '../components/BackButton.jsx';
import './Dnd.css';
import { useEffect, useState } from 'react';
import { Store } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';

export default function DndDiscord() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load('secrets.json');
        const t = await store.get('discord.botToken');
        if (typeof t === 'string' && t) {
          setToken(t);
        } else {
          // Attempt to import from a project-root secrets.json if present
          try {
            const abs = await invoke('resolve_resource', { path: 'secrets.json' });
            const bytes = await invoke('read_file_bytes', { path: abs });
            if (Array.isArray(bytes) && bytes.length) {
              const txt = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
              const data = JSON.parse(txt);
              const bot = data?.discord?.botToken;
              if (typeof bot === 'string' && bot) {
                await store.set('discord.botToken', bot);
                await store.save();
                setToken(bot);
              }
            }
          } catch {
            // ignore
          }
        }
      } catch (e) {
        console.warn('Failed to load discord token from secrets', e);
      }
    })();
  }, []);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Discord</h1>
      <p>Provide your Discord bot token. It is saved to the app store and can be synced to the Python service.</p>
      <div style={{ display: 'grid', gap: '0.5rem', maxWidth: 640 }}>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          Bot Token
          <input
            type="password"
            value={token}
            onChange={async (e) => {
              const v = e.target.value;
              setToken(v);
              try {
                const store = await Store.load('secrets.json');
                await store.set('discord.botToken', v);
                await store.save();
                setStatus('Saved');
                setTimeout(() => setStatus(''), 1200);
              } catch (err) {
                console.warn('Failed to save token', err);
              }
            }}
            placeholder="Paste your Discord bot token"
          />
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={async () => {
              try {
                await invoke('write_discord_token', { token });
                setStatus('Synced to Python config/discord_token.txt');
                setTimeout(() => setStatus(''), 2000);
              } catch (e) {
                console.error(e);
                setStatus('Failed to sync to Python');
                setTimeout(() => setStatus(''), 3000);
              }
            }}
            disabled={!token}
          >
            Sync to Python
          </button>
          {status && <span style={{ opacity: 0.8 }}>{status}</span>}
        </div>
      </div>
    </>
  );
}
