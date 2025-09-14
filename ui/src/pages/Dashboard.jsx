import Card from '../components/Card.jsx';

export default function Dashboard() {
  return (
    <>
      <header>
        <h1>Blossom Music Generation</h1>
      </header>
      <main className="dashboard">
        <Card
          to="/music-generator/musicgen"
          icon="Music2"
          title="MusicGen"
        />
        <Card to="/dnd" icon="Dice5" title="Dungeons & Dragons" />
        <Card to="/settings" icon="Settings" title="Settings" />
        <Card to="/train" icon="Sliders" title="Train Model" />
        <Card to="/models" icon="Package" title="Available Models" />
      </main>
    </>
  );
}

