import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

export default function DndVoiceLabs() {
  return (
    <>
      <BackButton />
      <h1>AI Voice Labs</h1>
      <section className="dashboard dnd-card-grid">
        <Card to="/tools/voices/piper" icon="Mic2" title="Piper">
          Discover voices and synthesize dialogue offline with Piper.
        </Card>
        <Card to="/tools/voices/eleven" icon="Waves" title="ElevenLabs">
          Cloud voices via ElevenLabs. Use secrets.json, then test lines.
        </Card>
        <Card to="/tools/voices/manage" icon="Wrench" title="Manage Voices">
          Eleven Labs only
        </Card>
      </section>
    </>
  );
}
