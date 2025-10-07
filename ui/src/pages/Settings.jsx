import BackButton from '../components/BackButton.jsx';
import LogPanel from '../components/LogPanel';
import SettingsAbout from '../components/SettingsAbout.jsx';
import './Settings.css';

export default function Settings() {
  return (
    <main className="settings">
      <BackButton />
      <h1>Advanced Settings</h1>
      <SettingsAbout />
      <section className="settings-section">
        <LogPanel />
      </section>
    </main>
  );
}
