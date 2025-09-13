import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import OnnxCrafter from './pages/OnnxCrafter.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/onnx" element={<OnnxCrafter />} />
    </Routes>
  );
}
