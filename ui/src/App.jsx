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
import MusicLang from './pages/MusicLang.jsx';
import MusicGen from './pages/MusicGen.jsx';
import BackButton from './components/BackButton.jsx';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/music-generator" element={<><BackButton /><MusicGenerator /></>} />
        <Route path="/music-generator/algorithmic" element={<><BackButton /><Generate /></>} />
        <Route path="/music-generator/musiclang" element={<><BackButton /><MusicLang /></>} />
        <Route path="/music-generator/musicgen" element={<><BackButton /><MusicGen /></>} />
        <Route path="/generate" element={<><BackButton /><Generate /></>} />
        <Route path="/dnd" element={<><BackButton /><Dnd /></>} />
        <Route path="/settings" element={<><BackButton /><Settings /></>} />
        <Route path="/profiles" element={<><BackButton /><Profiles /></>} />
        <Route path="/train" element={<><BackButton /><Train /></>} />
        <Route path="/onnx" element={<><BackButton /><OnnxCrafter /></>} />
        <Route path="/models" element={<><BackButton /><Models /></>} />
      </Routes>
    </>
  );
}

