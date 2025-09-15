import Card from '../components/Card.jsx';

export default function Dashboard() {
  return (
    <>
      <header>
        <h1>Blossom Music Generation</h1>
      </header>
      <main className="dashboard">
        <Card to="/musicgen" icon="Music" title="MusicGen" />
        <Card to="/dnd" icon="Dice5" title="Dungeons & Dragons" />
        <Card to="/games" icon="Gamepad2" title="Games" />
        <Card to="/tools" icon="Wrench" title="Tools" />
        <Card to="/settings" icon="Settings" title="Settings" />
      </main>
    </>
  );
}

