import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';

export default function Tools() {
  return (
    <>
      <BackButton />
      <h1>Tools</h1>
      <section className="dashboard">
        <Card to="/tools/voices" icon="Mic2" title="AI Voice Labs">
          Piper + ElevenLabs
        </Card>
        <Card to="/fusion" icon="Atom" title="Fusion">
          Concept Combiner
        </Card>
        <Card to="/queue" icon="ListTodo" title="Job Queue">
          Queued + Running Jobs
        </Card>
        <Card to="/pipeline" icon="Workflow" title="Pipelines">
          Launch the unified pipelines experience
        </Card>
        <Card to="/chat" icon="MessagesSquare" title="General Chat">
          Converse with Blossom
        </Card>
        <Card to="/tools/video-to-image" icon="Clapperboard" title="Video to Image">
          Extract frames from video
        </Card>
        <Card to="/tools/canvas" icon="Brush" title="Canvas">
          Collaborative art board
        </Card>
        <Card to="/train" icon="Sliders" title="Train Model">
          Custom Model Trainer
        </Card>
      </section>
    </>
  );
}

