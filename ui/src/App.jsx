import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Dnd from './pages/Dnd.jsx';
import DndChat from './pages/DndChat.jsx';
import DndDiscord from './pages/DndDiscord.jsx';
import DndLore from './pages/DndLore.jsx';
import DndNpcs from './pages/DndNpcs.jsx';
import DndPiper from './pages/DndPiper.jsx';
import Settings from './pages/Settings.jsx';
import Train from './pages/Train.jsx';
import Profiles from './pages/Profiles.jsx';
import MusicGen from './pages/MusicGen.jsx';
import AlgorithmicGenerator from './pages/Generate.jsx';
import SoundLab from './pages/SoundLab.jsx';
import Queue from './pages/Queue.jsx';
import Tools from './pages/Tools.jsx';
import Fusion from './pages/Fusion.jsx';
import LoopMaker from './pages/LoopMaker.jsx';
import BeatMaker from './pages/BeatMaker.jsx';
import Games from './pages/Games.jsx';
import RainBlocks from './pages/RainBlocks.jsx';
import Snake from './pages/Snake.jsx';
import BrickBreaker from './pages/BrickBreaker.jsx';
import AlbumMaker from './pages/AlbumMaker.jsx';
import Calendar from './pages/Calendar.jsx';
import GeneralChat from './pages/GeneralChat.jsx';
import { Store } from '@tauri-apps/plugin-store';
import { useEffect, useState } from 'react';

function UserSelectorOverlay({ onClose }) {
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const store = new Store('users.json');
        const list = await store.get('users');
        setUsers(Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v) : []);
      } catch (e) {
        console.warn('Failed to load users', e);
      }
    })();
  }, []);

  const choose = async (who) => {
    try {
      const store = new Store('users.json');
      await store.set('currentUser', who);
      await store.save();
      onClose?.();
    } catch (e) {
      console.error('Failed to set current user', e);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const store = new Store('users.json');
      const list = await store.get('users');
      const next = Array.isArray(list) ? list.slice() : [];
      if (!next.includes(trimmed)) next.push(trimmed);
      await store.set('users', next);
      await store.set('currentUser', trimmed);
      await store.save();
      onClose?.();
    } catch (e) {
      console.error('Failed to create user', e);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'grid', placeItems: 'center', zIndex: 9999
    }}>
      <div style={{ background: 'var(--card-bg)', color: 'var(--text)', padding: '1rem', borderRadius: 8, minWidth: 360 }}>
        <h2>Select User</h2>
        {users.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {users.map((u) => (
              <button key={u} className="p-sm" onClick={() => choose(u)}>{u}</button>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.8, marginBottom: '0.5rem' }}>No users found.</div>
        )}
        <form onSubmit={create} style={{ display: 'grid', gap: '0.5rem' }}>
          <label>
            Create new user
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="p-sm" style={{ width: '100%' }} />
          </label>
          <button type="submit" className="p-sm">Create & Use</button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [needsUser, setNeedsUser] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const store = new Store('users.json');
        const current = await store.get('currentUser');
        setNeedsUser(!(typeof current === 'string' && current));
      } catch (e) {
        console.warn('Failed to read current user', e);
      }
    })();
  }, []);
  return (
    <>
      {needsUser && (
        <UserSelectorOverlay onClose={() => setNeedsUser(false)} />
      )}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/musicgen" element={<SoundLab />}>
          <Route path="musicgen" element={<MusicGen />} />
          <Route path="algorithmic" element={<AlgorithmicGenerator />} />
        </Route>
        <Route path="/dnd" element={<Dnd />} />
        <Route path="/dnd/lore" element={<DndLore />} />
        <Route path="/dnd/npcs" element={<DndNpcs />} />
        <Route path="/dnd/piper" element={<DndPiper />} />
        <Route path="/dnd/discord" element={<DndDiscord />} />
        <Route path="/dnd/chat" element={<DndChat />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/train" element={<Train />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/chat" element={<GeneralChat />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/fusion" element={<Fusion />} />
        <Route path="/loopmaker" element={<LoopMaker />} />
        <Route path="/beatmaker" element={<BeatMaker />} />
        <Route path="/album" element={<AlbumMaker />} />
        <Route path="/games" element={<Games />} />
        <Route path="/games/rain-blocks" element={<RainBlocks />} />
        <Route path="/games/brick-breaker" element={<BrickBreaker />} />
        <Route path="/games/snake" element={<Snake />} />
      </Routes>
    </>
  );
}

