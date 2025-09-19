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

export default function App() {
  return (
    <>
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

