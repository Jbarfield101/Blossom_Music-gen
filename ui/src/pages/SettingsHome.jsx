import SettingsAbout from '../components/SettingsAbout.jsx';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Settings.css';

const sections = [
  { to: '/settings/users', icon: 'User', title: 'Users', description: 'Switch or manage users.' },
  { to: '/settings/discord', icon: 'MessageSquare', title: 'Discord', description: 'Instructions for configuring your bot token.' },
  { to: '/settings/appearance', icon: 'Palette', title: 'Appearance', description: 'Theme, accent color, and font size.' },
  { to: '/settings/models', icon: 'HardDrive', title: 'Models & Voices', description: 'Manage Whisper, LLM, and Piper voices.' },
  { to: '/settings/advanced', icon: 'Settings', title: 'Advanced Settings', description: 'Diagnostics and activity logs.' },
];

export default function SettingsHome() {
  return (
    <>
      <BackButton />
      <h1>Settings</h1>
      <SettingsAbout className="settings-home-about" legend="About Blossom" />
      <main className="dashboard dnd-card-grid">
        {sections.map(({ to, icon, title, description }) => (
          <Card key={title + to} to={to} icon={icon} title={title}>
            {description}
          </Card>
        ))}
      </main>
    </>
  );
}
