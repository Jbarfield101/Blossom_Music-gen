import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Dnd from './pages/Dnd.jsx';
import Settings from './pages/Settings.jsx';
import Train from './pages/Train.jsx';
import Profiles from './pages/Profiles.jsx';
import MusicGen from './pages/MusicGen.jsx';
import Tools from './pages/Tools.jsx';
import Fusion from './pages/Fusion.jsx';
import LoopMaker from './pages/LoopMaker.jsx';
import BeatMaker from './pages/BeatMaker.jsx';
import Games from './pages/Games.jsx';
import RainBlocks from './pages/RainBlocks.jsx';
import Snake from './pages/Snake.jsx';
import BrickBreaker from './pages/BrickBreaker.jsx';
import AlbumMaker from './pages/AlbumMaker.jsx';

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
        <Route path="/tools" element={<Tools />} />
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

