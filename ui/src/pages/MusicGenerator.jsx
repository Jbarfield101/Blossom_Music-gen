import Card from '../components/Card.jsx';
import BackButton from '../components/BackButton.jsx';

export default function MusicGenerator() {
  return (
    <>
      <header>
        <BackButton />
        <h1>Music Generator</h1>
      </header>
      <main className="dashboard">
        <Card
          to="/music-generator/algorithmic"
          icon="Cpu"
          title="Algorithmic"
        />
        <Card
          to="/music-generator/phrase"
          icon="FileText"
          title="Phrase Model"
        />
        <Card
          to="/music-generator/musiclang"
          icon="BookOpen"
          title="MusicLang"
        />
        <Card
          to="/music-generator/musicgen"
          icon="Music2"
          title="MusicGen"
        />
      </main>
    </>
  );
}

