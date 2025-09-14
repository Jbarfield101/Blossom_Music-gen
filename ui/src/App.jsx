import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Dnd from './pages/Dnd.jsx';
import Settings from './pages/Settings.jsx';
import Train from './pages/Train.jsx';
import Profiles from './pages/Profiles.jsx';
import MusicGen from './pages/MusicGen.jsx';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/musicgen" element={<MusicGen />} />
        <Route path="/dnd" element={<Dnd />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/train" element={<Train />} />
      </Routes>
    </>
  );
}

