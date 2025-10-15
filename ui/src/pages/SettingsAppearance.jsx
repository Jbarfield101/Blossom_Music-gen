import { useEffect, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { setTheme, getTheme, setAccent, getAccent, setBaseFontSize, getBaseFontSize } from '../../theme.js';
import './Settings.css';

export default function SettingsAppearance() {
  const [theme, setThemeState] = useState('dark');
  const [accent, setAccentState] = useState('#ff4d6d');
  const [baseFontSize, setBaseFontSizeState] = useState('16px');

  useEffect(() => {
    getTheme().then((saved) => setThemeState(saved || 'dark'));
    getAccent().then((saved) => {
      if (saved) setAccentState(saved);
      else {
        const def = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        setAccentState(def || '#ff4d6d');
      }
    });
    getBaseFontSize().then((saved) => {
      const size = saved || '16px';
      setBaseFontSizeState(size);
      setBaseFontSize(size);
    });
  }, []);

  return (
    <section className="settings">
      <BackButton />
      <h1>Settings · Appearance</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Theme</legend>
          <select value={theme} onChange={async (e) => { const t = e.target.value; await setTheme(t); setThemeState(t); }}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </fieldset>
      </section>
      <section className="settings-section">
        <fieldset>
          <legend>Accent</legend>
          <input type="color" value={accent} onChange={async (e) => { const c = e.target.value; await setAccent(c); setAccentState(c); }} />
        </fieldset>
      </section>
      <section className="settings-section">
        <fieldset>
          <legend>Font Size</legend>
          <select value={baseFontSize} onChange={async (e) => { const s = e.target.value; await setBaseFontSize(s); setBaseFontSizeState(s); }}>
            <option value="16px">Default</option>
            <option value="18px">Large</option>
          </select>
        </fieldset>
      </section>
    </section>
  );
}

