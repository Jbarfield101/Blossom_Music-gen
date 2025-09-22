import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getConfig, setConfig } from '../api/config';
import BackButton from '../components/BackButton.jsx';
import './Settings.css';

export default function SettingsVault() {
  const VAULT_KEY = 'vaultPath';
  const [vault, setVault] = useState('');
  const [vaultError, setVaultError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const path = await getConfig(VAULT_KEY);
        setVault(path || '');
        setVaultError('');
      } catch (e) {
        console.warn('Failed to read vault config', e);
      }
    })();
  }, []);

  const chooseVault = async () => {
    try {
      const res = await openDialog({ directory: true });
      if (!res) return;
      const path = Array.isArray(res)
        ? typeof res[0] === 'string' ? res[0] : res[0]?.path
        : typeof res === 'string' ? res : res?.path;
      if (!path) {
        setVaultError('Could not determine the vault folder. Please try again.');
        return;
      }
      await invoke('select_vault', { path });
      await setConfig(VAULT_KEY, path);
      setVault(path);
      setVaultError('');
    } catch (err) {
      console.error('Folder selection failed', err);
      setVaultError('Failed to open the vault picker. Please try again.');
    }
  };

  return (
    <main className="settings">
      <BackButton />
      <h1>Settings · Vault</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Obsidian Vault</legend>
          <p>Vault path: {vault || '(none)'}</p>
          {vaultError && <p className="error">{vaultError}</p>}
          <div className="button-row">
            <button type="button" onClick={chooseVault}>Choose Vault</button>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Picking a vault starts the background watcher and enables note-backed features.
          </p>
        </fieldset>
      </section>
    </main>
  );
}

