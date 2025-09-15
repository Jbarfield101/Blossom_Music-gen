import { useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';

const CELL_SIZE = 20;
const WIDTH = 400;
const HEIGHT = 400;
const GRID_WIDTH = WIDTH / CELL_SIZE;
const GRID_HEIGHT = HEIGHT / CELL_SIZE;

const INITIAL_SNAKE = [{ x: 5, y: 5 }];

const directionByKey = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

function randomFood(snakePositions) {
  const occupied = new Set(
    snakePositions.map((segment) => `${segment.x},${segment.y}`)
  );

  if (occupied.size >= GRID_WIDTH * GRID_HEIGHT) {
    return snakePositions[0];
  }

  let position = null;
  do {
    position = {
      x: Math.floor(Math.random() * GRID_WIDTH),
      y: Math.floor(Math.random() * GRID_HEIGHT),
    };
  } while (occupied.has(`${position.x},${position.y}`));

  return position;
}

export default function Snake() {
  const [snake, setSnake] = useState(INITIAL_SNAKE);
  const [direction, setDirection] = useState({ x: 1, y: 0 });
  const [food, setFood] = useState(() => randomFood(INITIAL_SNAKE));
  const [gameOver, setGameOver] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const newDirection = directionByKey[event.key];
      if (!newDirection) {
        return;
      }

      setDirection((prevDirection) => {
        if (gameOver) {
          return prevDirection;
        }

        if (
          prevDirection.x === -newDirection.x &&
          prevDirection.y === -newDirection.y
        ) {
          return prevDirection;
        }

        return newDirection;
      });
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameOver]);

  useEffect(() => {
    if (gameOver) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setSnake((prevSnake) => {
        const head = prevSnake[0];
        const newHead = {
          x: head.x + direction.x,
          y: head.y + direction.y,
        };

        const hitWall =
          newHead.x < 0 ||
          newHead.y < 0 ||
          newHead.x >= GRID_WIDTH ||
          newHead.y >= GRID_HEIGHT;

        const hitSelf = prevSnake
          .slice(0, -1)
          .some((segment) => segment.x === newHead.x && segment.y === newHead.y);

        if (hitWall || hitSelf) {
          setGameOver(true);
          return prevSnake;
        }

        const ateFood = newHead.x === food.x && newHead.y === food.y;

        if (ateFood) {
          const grownSnake = [newHead, ...prevSnake];
          setFood(randomFood(grownSnake));
          return grownSnake;
        }

        return [newHead, ...prevSnake.slice(0, prevSnake.length - 1)];
      });
    }, 100);

    return () => {
      clearInterval(intervalId);
    };
  }, [direction, food, gameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    context.fillStyle = '#111827';
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.fillStyle = '#ef4444';
    context.fillRect(
      food.x * CELL_SIZE,
      food.y * CELL_SIZE,
      CELL_SIZE,
      CELL_SIZE
    );

    snake.forEach((segment, index) => {
      context.fillStyle = index === 0 ? '#22c55e' : '#4ade80';
      context.fillRect(
        segment.x * CELL_SIZE,
        segment.y * CELL_SIZE,
        CELL_SIZE,
        CELL_SIZE
      );
    });

    if (gameOver) {
      context.fillStyle = 'rgba(0, 0, 0, 0.5)';
      context.fillRect(0, 0, WIDTH, HEIGHT);

      context.fillStyle = '#f87171';
      context.font = '24px sans-serif';
      context.textAlign = 'center';
      context.fillText('Game Over', WIDTH / 2, HEIGHT / 2);
    }
  }, [snake, food, gameOver]);

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
