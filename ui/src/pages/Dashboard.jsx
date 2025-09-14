import Card from '../components/Card.jsx';
import { Music, Dice5, Settings, Sliders, Package, Brain } from 'lucide-react';

export default function Dashboard() {
  return (
    <>
      <header>
        <h1>Blossom Music Generation</h1>
      </header>
      <main className="dashboard">
        <Card to="/generate" icon={Music} title="Music Generator" />
        <Card to="/dnd" icon={Dice5} title="Dungeons & Dragons" />
        <Card to="/settings" icon={Settings} title="Settings" />
        <Card to="/train" icon={Sliders} title="Train Model" />
        <Card to="/models" icon={Package} title="Available Models" />
        <Card to="/onnx" icon={Brain} title="ONNX Crafter" />
      </main>
    </>
  );
}

