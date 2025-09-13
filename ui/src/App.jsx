import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Generate from './pages/Generate.jsx';
import Dnd from './pages/Dnd.jsx';
import Settings from './pages/Settings.jsx';
import Train from './pages/Train.jsx';
import OnnxCrafter from './pages/OnnxCrafter.jsx';
import Profiles from './pages/Profiles.jsx';
import Sidebar from './components/Sidebar.jsx';

export default function App() {
  return (
    <>
      <Sidebar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/generate" element={<Generate />} />
        <Route path="/dnd" element={<Dnd />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/train" element={<Train />} />
        <Route path="/onnx" element={<OnnxCrafter />} />
      </Routes>
    </>
  );
}
