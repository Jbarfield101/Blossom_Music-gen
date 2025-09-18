import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './Snake.css';

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
  const [isRunning, setIsRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const storedHighScore = window.localStorage.getItem('snakeHighScore');
      if (!storedHighScore) {
        return;
      }

      const parsedHighScore = Number.parseInt(storedHighScore, 10);
      if (!Number.isNaN(parsedHighScore)) {
        setHighScore(parsedHighScore);
      }
    } catch {
      // Ignore storage access failures and fall back to the default high score.
    }
  }, []);

  const resetGameState = useCallback(() => {
    const startingSnake = INITIAL_SNAKE.map((segment) => ({ ...segment }));
    setSnake(startingSnake);
    setDirection({ x: 1, y: 0 });
    setFood(randomFood(startingSnake));
    setGameOver(false);
    setScore(0);
  }, []);

  const startGame = useCallback(() => {
    setIsRunning((prevIsRunning) => {
      if (prevIsRunning) {
        return prevIsRunning;
      }

      resetGameState();
      return true;
    });
  }, [resetGameState]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const newDirection = directionByKey[event.key];

      if (!isRunning) {
        startGame();
      }

      if (!newDirection) {
        return;
      }

      setDirection((prevDirection) => {
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
  }, [isRunning, startGame]);

  useEffect(() => {
    if (gameOver || !isRunning) {
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
          setScore((prev) => prev + 1);
          setFood(randomFood(grownSnake));
          return grownSnake;
        }

        return [newHead, ...prevSnake.slice(0, prevSnake.length - 1)];
      });
    }, 100);

    return () => {
      clearInterval(intervalId);
    };
  }, [direction, food, gameOver, isRunning]);

  useEffect(() => {
    if (gameOver) {
      setIsRunning(false);
    }
  }, [gameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    context.clearRect(0, 0, WIDTH, HEIGHT);
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
  }, [snake, food]);

  useEffect(() => {
    if (!gameOver) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.fillStyle = '#f87171';
    context.font = '24px sans-serif';
    context.textAlign = 'center';
    context.fillText('Game Over', WIDTH / 2, HEIGHT / 2);
  }, [gameOver]);

  return (
    <>
      <BackButton />
      <div className="game-container">
        <h1>Snake</h1>
        <header className="game-hud">
          <p className="game-score">Score: {score}</p>
          <p className="game-score">High Score: {highScore}</p>
        </header>
        <div className="game-board">
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            className="game-canvas"
          ></canvas>
          {!isRunning && (
            <div className="game-overlay">
              <div className="game-overlay-content">
                {gameOver && (
                  <p className="game-overlay-title">Game Over</p>
                )}
                <p className="game-overlay-text">Press Start</p>
                <button
                  type="button"
                  className="game-overlay-button"
                  onClick={startGame}
                >
                  Start
                </button>
                <p className="game-overlay-hint">Press any key to begin</p>
              </div>
            </div>
          )}
        </div>
        <footer className="game-hud game-hud--footer" aria-hidden="true" />
      </div>
    </>
  );
}
