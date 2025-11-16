import BackButton from '../components/BackButton.jsx';
import LogPanel from '../components/LogPanel';
import SettingsAbout from '../components/SettingsAbout.jsx';
import SettingsAudioGreeting from '../components/SettingsAudioGreeting.jsx';
import SettingsOnStart from '../components/SettingsOnStart.jsx';
import './Settings.css';

export default function Settings() {
  return (
    <section className="settings">
      <BackButton />
      <h1>Advanced Settings</h1>
      <SettingsAbout />
      <SettingsOnStart />
      <SettingsAudioGreeting />
      <section className="settings-section">
        <LogPanel />
      </section>
    </section>
  );
}
