import { useState } from 'react';
import BackButton from '../components/BackButton.jsx';

export default function Fusion() {
  const [conceptA, setConceptA] = useState('');
  const [conceptB, setConceptB] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // TODO: implement fusion logic
  };

  return (
    <>
      <BackButton />
      <h1>Fusion Loop Maker</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="First concept"
          value={conceptA}
          onChange={(e) => setConceptA(e.target.value)}
        />
        <input
          type="text"
          placeholder="Second concept"
          value={conceptB}
          onChange={(e) => setConceptB(e.target.value)}
        />
        <textarea
          placeholder="Notes or description"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button type="submit">Fuse Concepts</button>
      </form>
    </>
  );
}

