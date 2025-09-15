import { useEffect, useRef } from 'react';
import BackButton from '../components/BackButton.jsx';

export default function Snake() {
  const gameRef = useRef(null);

  useEffect(() => {
    // TODO: Implement Snake game logic
  }, []);

  return (
    <>
      <BackButton />
      <h1>Snake</h1>
      <div ref={gameRef} className="game-container"></div>
    </>
  );
}
