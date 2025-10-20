import { useOutlet } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';

export default function VisualGenerator() {
  const outlet = useOutlet();

  if (outlet) {
    return outlet;
  }

  return (
    <>
      <BackButton />
      <h1>Visual Generator</h1>
      <section className="dashboard">
        <Card to="/visual-generator/lofi-scene-maker" icon="Sparkles" title="Lofi Scene Maker">
          Craft cozy animated scenes with looping ambience.
        </Card>
        <Card icon="Film" title="Video Maker" disabled>
          Build short-form visuals from scripted storyboards.
        </Card>
        <Card icon="UserCircle2" title="DND Portrait" disabled>
          Generate character portraits tailored to your campaign.
        </Card>
      </section>
    </>
  );
}
