import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Dnd from './pages/Dnd.jsx';
import Settings from './pages/Settings.jsx';
import Train from './pages/Train.jsx';
import OnnxCrafter from './pages/OnnxCrafter.jsx';
import Profiles from './pages/Profiles.jsx';
import Models from './pages/Models.jsx';
import Generate from './pages/Generate.jsx';
import MusicGenerator from './pages/MusicGenerator.jsx';
import PhraseModel from './pages/PhraseModel.jsx';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/music-generator" element={<MusicGenerator />} />
        <Route path="/music-generator/algorithmic" element={<Generate />} />
        <Route path="/music-generator/phrase" element={<PhraseModel />} />
        <Route path="/generate" element={<Generate />} />
        <Route path="/dnd" element={<Dnd />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/train" element={<Train />} />
        <Route path="/onnx" element={<OnnxCrafter />} />
        <Route path="/models" element={<Models />} />
      </Routes>
    </>
  );
}

