import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';

export default function Games() {
  return (
    <>
      <BackButton />
      <h1>Games</h1>
      <main className="dashboard">
        <Card to="/games/rain-blocks" icon="Blocks" title="Rain Blocks" />
        <Card to="/games/brick-breaker" icon="Gamepad2" title="Brick Breaker" />
        <Card to="/games/snake" icon="Worm" title="Snake" />
      </main>
    </>
  );
}
