import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';

export default function Tools() {
  return (
    <>
      <BackButton />
      <h1>Tools</h1>
      <main className="dashboard">
        <Card to="/fusion" icon="Atom" title="Fusion">
          Concept Combiner
        </Card>
        <Card to="/loopmaker" icon="Repeat" title="Loop Maker">
          Beat Loop Creator
        </Card>
        <Card to="/beatmaker" icon="Waveform" title="Beat Maker">
          Audio Loop Builder
        </Card>
        <Card to="/album" icon="Disc3" title="Album Maker">
          Cover + Tracklist Generator
        </Card>
        <Card to="/train" icon="Sliders" title="Train Model">
          Custom Model Trainer
        </Card>
      </main>
    </>
  );
}

