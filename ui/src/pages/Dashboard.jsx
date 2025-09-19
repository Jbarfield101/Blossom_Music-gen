import FeatureWheel from '../components/FeatureWheel.jsx';
import Screen from '../components/Screen.jsx';
import './Dashboard.css';

export default function Dashboard() {
  const items = [
    { to: '/musicgen', icon: 'Music', title: 'Sound Lab' },
    { to: '/dnd', icon: 'Dice5', title: 'Dungeons & Dragons' },
    { to: '/games', icon: 'Gamepad2', title: 'Games' },
    { to: '/tools', icon: 'Wrench', title: 'Tools' },
    { to: '/settings', icon: 'Settings', title: 'Settings' },
  ];

  return (
    <>
      <header className="dashboard-header">
        <h1>Blossom</h1>
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

