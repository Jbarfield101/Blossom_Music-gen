import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Dnd from './pages/Dnd.jsx';
import Settings from './pages/Settings.jsx';
import Train from './pages/Train.jsx';
import Profiles from './pages/Profiles.jsx';
import AlgorithmicGenerator from './pages/Generate.jsx';
import MusicGenerator from './pages/MusicGenerator.jsx';
import MusicLang from './pages/MusicLang.jsx';
import MusicGen from './pages/MusicGen.jsx';
import PhraseModel from './pages/PhraseModel.jsx';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/music-generator" element={<MusicGenerator />} />
        <Route path="/music-generator/algorithmic" element={<AlgorithmicGenerator />} />
        <Route path="/music-generator/phrase" element={<PhraseModel />} />
        <Route path="/music-generator/musiclang" element={<MusicLang />} />
        <Route path="/music-generator/musicgen" element={<MusicGen />} />
        <Route path="/generate" element={<AlgorithmicGenerator />} />
        <Route path="/dnd" element={<Dnd />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/train" element={<Train />} />
      </Routes>
    </>
  );
}

