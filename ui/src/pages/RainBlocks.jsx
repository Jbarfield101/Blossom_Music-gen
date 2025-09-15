import { useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';

export const CELL_SIZE = 24;
export const BOARD_COLUMNS = 10;
export const BOARD_ROWS = 20;
export const CANVAS_WIDTH = BOARD_COLUMNS * CELL_SIZE;
export const CANVAS_HEIGHT = BOARD_ROWS * CELL_SIZE;

export default function RainBlocks() {
  const canvasRef = useRef(null);
  const [gameOverMessage, setGameOverMessage] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    context.fillStyle = '#111827';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    setGameOverMessage(null);
  }, [canvasRef, setGameOverMessage]);

  return (
    <>
      <BackButton />
      <h1>Rain Blocks</h1>
      {gameOverMessage && (
        <p className="game-over-message">{gameOverMessage}</p>
      )}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="game-canvas"
      ></canvas>
    </>
  );
}
