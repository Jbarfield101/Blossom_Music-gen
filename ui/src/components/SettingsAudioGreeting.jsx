import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';
import LabeledToggle from './LabeledToggle.jsx';

const GREETING_PLACEHOLDER = 'Welcome back, {name}. What shall we work on today?';

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function getErrorMessage(error) {
  if (!error) return 'Unable to load audio greeting preferences.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || 'Unable to load audio greeting preferences.';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export default function SettingsAudioGreeting() {
  const [status, setStatus] = useState('loading');
  const [currentUser, setCurrentUser] = useState('');
  const [audioGreetingEnabled, setAudioGreetingEnabled] = useState(true);
  const [greetingText, setGreetingText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadPreferences = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const native = await isTauri();
      if (!native) {
        setStatus('unsupported');
        return;
      }

      const store = await Store.load('users.json');
      const user = await store.get('currentUser');
      if (typeof user !== 'string' || !user) {
        setStatus('missing-user');
        setCurrentUser('');
        return;
      }

      const prefs = (await store.get('prefs')) || {};
      const activePrefs = prefs[user] || {};

      setCurrentUser(user);
      setAudioGreetingEnabled(activePrefs.audioGreeting !== false);
      setGreetingText(normalizeString(activePrefs.greetingText));
      setStatus('ready');
    } catch (err) {
      setError(getErrorMessage(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const persistPrefs = useCallback(
    async (next) => {
      if (!currentUser) return;
      setSaving(true);
      setError('');
      try {
        const store = await Store.load('users.json');
        const prefs = (await store.get('prefs')) || {};
        prefs[currentUser] = { ...(prefs[currentUser] || {}), ...next };
        await store.set('prefs', prefs);
        await store.save();
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setSaving(false);
      }
    },
    [currentUser],
  );

  const handleToggleChange = async (checked) => {
    setAudioGreetingEnabled(checked);
    await persistPrefs({ audioGreeting: checked });
  };

  const handleGreetingChange = async (event) => {
    const value = event.target.value;
    setGreetingText(value);
    await persistPrefs({ greetingText: value });
  };

  let helperText = '';
  let helperModifier = '';
  if (status === 'unsupported') {
    helperText = 'Open the desktop app to change your greeting.';
  } else if (status === 'missing-user') {
    helperText = 'Select a user first to manage their greeting.';
  } else if (status === 'error') {
    helperText = error || 'Unable to load audio greeting preferences.';
    helperModifier = ' settings-audio-greeting-message--error';
  } else if (saving) {
    helperText = 'Saving your greeting...';
  } else if (status === 'loading') {
    helperText = 'Loading audio greeting preferences...';
  } else if (error) {
    helperText = error;
    helperModifier = ' settings-audio-greeting-message--error';
  } else {
    helperText = 'Play a short Piper greeting whenever you log into Blossom.';
  }

  const isReady = status === 'ready';

  return (
    <section className="settings-section settings-audio-greeting" aria-label="Audio greeting">
      <h2>Audio Greeting</h2>
      <p className="settings-audio-greeting-description">
        Use your Piper voice to greet the active user during login flows.
      </p>
      {isReady ? (
        <div className="settings-audio-greeting-fields">
          <LabeledToggle
            id="settings-audio-greeting-toggle"
            label="Enable greeting on login"
            description={`Applies to ${currentUser}. Use Settings → Users to change the active profile.`}
            checked={audioGreetingEnabled}
            disabled={saving}
            onChange={handleToggleChange}
          />
          <label className="settings-audio-greeting-input">
            <span>Greeting message</span>
            <input
              type="text"
              value={greetingText}
              placeholder={GREETING_PLACEHOLDER.replace('{name}', currentUser || '{name}')}
              onChange={handleGreetingChange}
              disabled={saving}
            />
            <small>Use {'{name}'} to insert the username. Example: {'Good afternoon, {name}.'}</small>
          </label>
        </div>
      ) : null}
      {helperText ? (
        <p className={`settings-audio-greeting-message${helperModifier}`}>{helperText}</p>
      ) : null}
    </section>
  );
}
