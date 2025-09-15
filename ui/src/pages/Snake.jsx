import { useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';

const CELL_SIZE = 20;
const WIDTH = 400;
const HEIGHT = 400;

export default function Snake() {
  const [snake, setSnake] = useState([{ x: 5, y: 5 }]);
  const [direction, setDirection] = useState({ x: 1, y: 0 });
  const [food, setFood] = useState({ x: 10, y: 10 });
  const [gameOver, setGameOver] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    // TODO: Implement Snake game logic
  }, []);

  return (
    <>
      <BackButton />
      <h1>Snake</h1>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="game-canvas"
      ></canvas>
    </>
  );
}
