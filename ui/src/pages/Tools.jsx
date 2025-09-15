import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';

export default function Tools() {
  return (
    <>
      <BackButton />
      <h1>Tools</h1>
      <main className="dashboard">
        <Card to="/fusion" icon="Atom" title="Fusion">
          Loop Maker
        </Card>
      </main>
    </>
  );
}

