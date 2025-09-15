import { useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './Fusion.css';

export default function Fusion() {
  const [conceptA, setConceptA] = useState('');
  const [conceptB, setConceptB] = useState('');
  const [fusionResult, setFusionResult] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();

    const trimmedA = conceptA.trim();
    const trimmedB = conceptB.trim();

    if (!trimmedA && !trimmedB) {
      setFusionResult('Enter concepts to explore their fusion.');
      return;
    }

    if (!trimmedA || !trimmedB) {
      setFusionResult('Add a second concept to complete the fusion.');
      return;
    }

    setFusionResult(`Fusion of ${trimmedA} and ${trimmedB} coming soon.`);
  };

  return (
    <div className="fusion">
      <BackButton />
      <h1>Fusion</h1>
      <form className="fusion-form" onSubmit={handleSubmit}>
        <div className="fusion-controls">
          <input
            className="fusion-input"
            type="text"
            placeholder="First concept"
            value={conceptA}
            onChange={(event) => setConceptA(event.target.value)}
          />
          <button className="fusion-button" type="submit">
            FUSE
          </button>
          <input
            className="fusion-input"
            type="text"
            placeholder="Second concept"
            value={conceptB}
            onChange={(event) => setConceptB(event.target.value)}
          />
        </div>
      </form>
      <div
        className="fusion-output"
        role="status"
        aria-live="polite"
      >
        {fusionResult || 'Fusion results will appear here.'}
      </div>
    </div>
  );
}

