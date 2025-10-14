import { useOutlet } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';

export default function SoundLab() {
  const outlet = useOutlet();

  if (outlet) {
    return outlet;
  }

  return (
    <>
      <BackButton />
      <h1>Sound Lab</h1>
      <main className="dashboard">
        <Card
          to="/musicgen/musicgen"
          icon="AudioWaveform"
          title="MusicGen"
        >
          Launch the classic prompt-to-music workflow.
        </Card>
        <Card
          to="/musicgen/stable-diffusion"
          icon="Sparkles"
          title="Stable Diffusion"
        >
          Edit Stable Audio prompts before running the diffusion workflow.
        </Card>
        <Card
          to="/musicgen/riffusion"
          icon="Music"
          title="Riffusion Music Generation"
        >
          Generate music using spectral diffusion techniques.
        </Card>
        <Card
          to="/musicgen/algorithmic"
          icon="Cpu"
          title="Algorithmic Generator"
        >
          Explore algorithmic arranging and rendering tools.
        </Card>
      </main>
    </>
  );
}
