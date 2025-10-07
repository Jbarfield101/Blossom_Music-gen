import { useEffect, useState } from 'react';
import { getVersion } from '../api/version';
import './SettingsAbout.css';

export default function SettingsAbout({ className = '', legend = 'About' }) {
  const [versions, setVersions] = useState({ app: '', python: '' });

  useEffect(() => {
    let active = true;

    getVersion()
      .then((fetched) => {
        if (!active) return;
        setVersions({
          app: fetched?.app ?? '',
          python: fetched?.python ?? '',
        });
      })
      .catch(() => {
        if (!active) return;
        setVersions({ app: '', python: '' });
      });

    return () => {
      active = false;
    };
  }, []);

  const sectionClassName = ['settings-section', className].filter(Boolean).join(' ');

  return (
    <section className={sectionClassName} aria-label="About Blossom">
      <fieldset>
        <legend>{legend}</legend>
        <dl className="settings-about-grid">
          <div>
            <dt>App Version</dt>
            <dd>{versions.app || '—'}</dd>
          </div>
          <div>
            <dt>Python Version</dt>
            <dd>{versions.python || '—'}</dd>
          </div>
        </dl>
      </fieldset>
    </section>
  );
}
