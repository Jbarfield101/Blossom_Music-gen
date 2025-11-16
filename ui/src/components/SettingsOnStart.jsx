import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import LabeledToggle from './LabeledToggle.jsx';

function normalizeBoolean(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function getErrorMessage(error) {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || 'Something went wrong.';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export default function SettingsOnStart() {
  const [status, setStatus] = useState('loading');
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      setError('');
      try {
        const native = await isTauri();
        if (cancelled) return;
        if (!native) {
          setStatus('unsupported');
          return;
        }
        const settings = await invoke('get_comfyui_settings');
        if (cancelled) return;
        setAutoLaunch(normalizeBoolean(settings?.auto_launch, true));
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAutoLaunchChange = async (checked) => {
    if (status !== 'ready') {
      return;
    }
    const previousValue = autoLaunch;
    setAutoLaunch(checked);
    setSaving(true);
    setError('');
    try {
      const settings = await invoke('update_comfyui_settings', {
        update: { autoLaunch: checked },
      });
      setAutoLaunch(normalizeBoolean(settings?.auto_launch, checked));
    } catch (err) {
      setAutoLaunch(previousValue);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  let message = '';
  let messageModifier = '';
  if (status === 'unsupported') {
    message = 'Open the desktop app to change launch behavior.';
  } else if (status === 'error') {
    message = error || 'Unable to load On Start settings.';
    messageModifier = ' settings-on-start-message--error';
  } else if (saving) {
    message = 'Saving preference...';
  } else if (status === 'loading') {
    message = 'Loading On Start preferences...';
  } else if (error) {
    message = error;
    messageModifier = ' settings-on-start-message--error';
  } else {
    message = 'Keep ComfyUI warm so ACE, lofi, and video jobs can spin up immediately.';
  }

  return (
    <section className="settings-section settings-on-start" aria-label="On start preferences">
      <h2>On Start</h2>
      <p className="settings-on-start-description">
        Pick what Blossom should prep as soon as the desktop shell opens.
      </p>
      {status === 'ready' ? (
        <LabeledToggle
          id="settings-on-start-autolaunch"
          label="Auto-launch ComfyUI"
          description="Boot ComfyUI alongside Blossom so renders can queue without waiting."
          checked={autoLaunch}
          disabled={saving}
          onChange={handleAutoLaunchChange}
        />
      ) : null}
      {message ? (
        <p className={`settings-on-start-message${messageModifier}`}>{message}</p>
      ) : null}
    </section>
  );
}
