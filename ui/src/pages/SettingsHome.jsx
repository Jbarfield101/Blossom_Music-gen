import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Settings.css';

const sections = [
  { to: '/settings/users', icon: 'User', title: 'Users', description: 'Switch or manage users.' },
  { to: '/settings/vault', icon: 'KeyRound', title: 'Vault', description: 'Configure your Obsidian vault path.' },
  { to: '/settings/appearance', icon: 'Palette', title: 'Appearance', description: 'Theme, accent color, and font size.' },
  { to: '/settings/models', icon: 'HardDrive', title: 'Models & Voices', description: 'Manage Whisper, LLM, and Piper voices.' },
  { to: '/settings/devices', icon: 'Headphones', title: 'Audio Devices', description: 'Input/output device selection.' },
  { to: '/settings/hotwords', icon: 'Mic', title: 'Hotwords', description: 'Add and toggle wake words.' },
  { to: '/settings/backup', icon: 'FileDown', title: 'Export/Import', description: 'Backup or restore your settings.' },
  { to: '/settings/advanced', icon: 'Settings', title: 'Advanced Settings', description: 'Full configuration and logs.' },
];

export default function SettingsHome() {
  return (
    <>
      <BackButton />
      <h1>Settings</h1>
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
