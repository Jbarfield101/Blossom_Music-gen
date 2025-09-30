import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import FeatureWheel from '../components/FeatureWheel.jsx';
import Screen from '../components/Screen.jsx';
import './Dashboard.css';

export default function Dashboard() {
  const [version, setVersion] = useState("");
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
  const items = [
    { to: '/musicgen', icon: 'Music', title: 'Sound Lab' },
    { to: '/calendar', icon: 'CalendarDays', title: 'Calendar' },
    { to: '/dnd', icon: 'Dice5', title: 'Dungeons & Dragons' },
    { to: '/games', icon: 'Gamepad2', title: 'Games' },
    { to: '/tools', icon: 'Wrench', title: 'Tools' },
    { to: '/settings', icon: 'Settings', title: 'Settings' },
  ];

  return (
    <>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Blossom</h1>
        {version && <div className="dashboard-version">v{version}</div>}
      </header>
      <main className="dashboard-main">
        <FeatureWheel items={items} />
        <div className="screen-wrapper">
          <Screen />
        </div>
      </main>
    </>
  );
}

