import { useEffect, useRef } from 'react';
import BackButton from '../components/BackButton.jsx';

export default function RainBlocks() {
  const gameRef = useRef(null);

  useEffect(() => {
    // TODO: Implement Rain Blocks game logic
  }, []);

  return (
    <>
      <BackButton />
      <h1>Rain Blocks</h1>
      <div ref={gameRef} className="game-container"></div>
    </>
  );
}
