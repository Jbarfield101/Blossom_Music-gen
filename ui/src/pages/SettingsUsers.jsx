import { useEffect, useState } from 'react';
import { Store } from '@tauri-apps/plugin-store';
import BackButton from '../components/BackButton.jsx';
import './Settings.css';

export default function SettingsUsers() {
  const [currentUser, setCurrentUser] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load('users.json');
        const cur = await store.get('currentUser');
        if (typeof cur === 'string') setCurrentUser(cur);
      } catch (e) {
        console.warn('Failed to load current user', e);
      }
    })();
  }, []);

  const switchUser = async () => {
    try {
      const store = await Store.load('users.json');
      await store.delete('currentUser');
      await store.save();
      setCurrentUser('');
      localStorage.removeItem('blossom.currentUser');
      location.reload();
    } catch (e) {
      console.error('Failed to clear current user', e);
    }
  };

  return (
    <main className="settings">
      <BackButton />
      <h1>Settings · Users</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Users</legend>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div>Current user: <strong>{currentUser || 'None'}</strong></div>
            <button type="button" onClick={switchUser}>Switch User</button>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Switching user clears the current selection and lets you pick a new one on next launch.
          </p>
        </fieldset>
      </section>
    </main>
  );
}

