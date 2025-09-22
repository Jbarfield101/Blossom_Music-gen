import BackButton from '../components/BackButton.jsx';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exportSettings as apiExportSettings, importSettings as apiImportSettings } from '../api/config';
import './Settings.css';

export default function SettingsBackup() {
  const exportSettings = async () => {
    const filePath = await saveDialog({ filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (filePath) await apiExportSettings(filePath);
  };
  const importSettings = async () => {
    const filePath = await openDialog({ filters: [{ name: 'JSON', extensions: ['json'] }], multiple: false });
    if (typeof filePath === 'string') await apiImportSettings(filePath);
  };
  return (
    <main className="settings">
      <BackButton />
      <h1>Settings · Export/Import</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Backup</legend>
          <div className="button-row">
            <button type="button" onClick={exportSettings}>Export Settings</button>
            <button type="button" onClick={importSettings}>Import Settings</button>
          </div>
        </fieldset>
      </section>
    </main>
  );
}

