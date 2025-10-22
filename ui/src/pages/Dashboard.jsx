import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';
import FeatureWheel from '../components/FeatureWheel.jsx';
import Screen from '../components/Screen.jsx';
import './Dashboard.css';

export default function Dashboard() {
  const [version, setVersion] = useState("");
  const [greeting, setGreeting] = useState('Welcome to Blossom.');
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await invoke('app_version');
        // res is expected to be { app: string, python: string }
        const appVer = (res && res.app) ? String(res.app) : "";
        if (mounted) setVersion(appVer);
      } catch {
        // ignore; leave version blank
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const store = await Store.load('users.json');
        if (!mounted) return;
        const current = await store.get('currentUser');
        if (!mounted) return;
        if (typeof current === 'string' && current.trim()) {
          const username = current.trim();
          const prefs = await store.get('prefs');
          if (!mounted) return;
          const perUser = prefs && typeof prefs === 'object' ? prefs[current] : undefined;
          const template = (
            perUser && typeof perUser.greetingText === 'string' && perUser.greetingText.trim()
          ) ? perUser.greetingText : 'Welcome back, {name}!';
          const message = template.includes('{name}')
            ? template.replace(/\{name\}/g, username)
            : template;
          if (mounted) {
            setGreeting(message);
          }
        } else {
          if (mounted) {
            setGreeting('Welcome to Blossom.');
          }
        }
      } catch (err) {
        console.warn('Failed to load greeting from store', err);
        if (mounted) {
          setGreeting('Welcome to Blossom.');
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const items = [
    { to: '/musicgen', icon: 'Music', title: 'Sound Lab' },
    { to: '/calendar', icon: 'CalendarDays', title: 'Calendar' },
    { to: '/dnd', icon: 'Dice5', title: 'Dungeons & Dragons' },
    { to: '/games', icon: 'Gamepad2', title: 'Games' },
    { to: '/tools', icon: 'Wrench', title: 'Tools' },
    { to: '/gallery', icon: 'Images', title: 'Gallery' },
    { to: '/visual-generator', icon: 'Palette', title: 'Visual Generator' },
    { to: '/settings', icon: 'Settings', title: 'Settings' },
  ];

  return (
    <>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Blossom</h1>
        {version && <div className="dashboard-version">v{version}</div>}
      </header>
      <section className="dashboard-main">
        <FeatureWheel items={items} />
        <div className="screen-wrapper">
          <Screen>
            <div className="dashboard-greeting">
              <p>{greeting}</p>
            </div>
          </Screen>
        </div>
      </section>
    </>
  );
}

