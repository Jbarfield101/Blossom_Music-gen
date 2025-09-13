import { Link } from 'react-router-dom';

export default function Dashboard() {
  return (
    <>
      <header>
        <h1>Blossom Music Generation</h1>
      </header>
      <main className="dashboard">
        <Link className="card" to="/generate">
          <span className="card-icon">🎵</span>
          <h2>Music Generator</h2>
        </Link>
        <Link className="card" to="/dnd">
          <span className="card-icon">🐉</span>
          <h2>Dungeons & Dragons</h2>
        </Link>
        <Link className="card" to="/settings">
          <span className="card-icon">⚙️</span>
          <h2>Settings</h2>
        </Link>
        <Link className="card" to="/train">
          <span className="card-icon">🎚️</span>
          <h2>Train Model</h2>
        </Link>
        <button
          className="card"
          type="button"
          title="Manage or download models"
          onClick={() => window.__TAURI__?.invoke('open_path', { path: 'models' })}
        >
          <span className="card-icon">📦</span>
          <h2>Manage/Download Models</h2>
        </button>
        <Link className="card" to="/onnx">
          <span className="card-icon">🧠</span>
          <h2>ONNX Crafter</h2>
        </Link>
      </main>
    </>
  );
}
