import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './RainBlocks.css';

export const CELL_SIZE = 24;
export const BOARD_COLUMNS = 10;
export const BOARD_ROWS = 20;
export const CANVAS_WIDTH = BOARD_COLUMNS * CELL_SIZE;
export const CANVAS_HEIGHT = BOARD_ROWS * CELL_SIZE;

const SHAPES = [
  {
    color: '#38bdf8',
    matrix: [[1, 1, 1, 1]],
  },
  {
    color: '#fbbf24',
    matrix: [
      [1, 1],
      [1, 1],
    ],
  },
  {
    color: '#4ade80',
    matrix: [
      [0, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    color: '#f87171',
    matrix: [
      [1, 0, 0],
      [1, 1, 1],
    ],
  },
  {
    color: '#a78bfa',
    matrix: [
      [0, 0, 1],
      [1, 1, 1],
    ],
  },
  {
    color: '#f472b6',
    matrix: [
      [0, 1, 1],
      [1, 1, 0],
    ],
  },
  {
    color: '#fb7185',
    matrix: [
      [1, 1, 0],
      [0, 1, 1],
    ],
  },
];

const createEmptyBoard = () =>
  Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLUMNS).fill(0));

export default function RainBlocks() {
  const canvasRef = useRef(null);
  const [board, setBoard] = useState(() => createEmptyBoard());
  const [activePiece, setActivePiece] = useState(null);
  const [gameOverMessage, setGameOverMessage] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const stored = Number(localStorage.getItem('rainblocksHighScore'));
    return Number.isNaN(stored) ? 0 : stored;
  });

  const boardRef = useRef(board);
  const activePieceRef = useRef(activePiece);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    activePieceRef.current = activePiece;
  }, [activePiece]);

  const isValidPosition = useCallback((shape, row, col) => {
    for (let r = 0; r < shape.length; r += 1) {
      for (let c = 0; c < shape[r].length; c += 1) {
        if (!shape[r][c]) {
          continue;
        }
        const newRow = row + r;
        const newCol = col + c;
        if (
          newRow < 0 ||
          newRow >= BOARD_ROWS ||
          newCol < 0 ||
          newCol >= BOARD_COLUMNS ||
          boardRef.current[newRow][newCol]
        ) {
          return false;
        }
      }
    }
    return true;
  }, []);

  const spawnNewPiece = useCallback(() => {
    const randomShape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const startCol = Math.floor(
      (BOARD_COLUMNS - randomShape.matrix[0].length) / 2,
    );

    if (!isValidPosition(randomShape.matrix, 0, startCol)) {
      setGameOverMessage('Game Over');
      activePieceRef.current = null;
      setActivePiece(null);
      return false;
    }

    const nextPiece = {
      row: 0,
      col: startCol,
      shape: randomShape.matrix,
      color: randomShape.color,
    };
    activePieceRef.current = nextPiece;
    setActivePiece(nextPiece);
    return true;
  }, [isValidPosition]);

  const resetGame = useCallback(() => {
    const freshBoard = createEmptyBoard();
    boardRef.current = freshBoard;
    setBoard(freshBoard);
    activePieceRef.current = null;
    setActivePiece(null);
    setGameOverMessage(null);
    setScore(0);
    spawnNewPiece();
  }, [spawnNewPiece]);

  const lockPiece = useCallback(
    (piece) => {
      setBoard((prev) => {
        const next = prev.map((row) => row.slice());
        piece.shape.forEach((rowArr, r) => {
          rowArr.forEach((cell, c) => {
            if (cell) {
              next[piece.row + r][piece.col + c] = piece.color;
            }
          });
        });

        let cleared = 0;
        const filtered = next.filter((row) => {
          const full = row.every((cell) => cell !== 0);
          if (full) {
            cleared += 1;
          }
          return !full;
        });
        while (filtered.length < BOARD_ROWS) {
          filtered.unshift(Array(BOARD_COLUMNS).fill(0));
        }
        if (cleared > 0) {
          setScore((prevScore) => {
            const newScore = prevScore + cleared * 100;
            setHighScore((prevHigh) => {
              const newHigh = Math.max(prevHigh, newScore);
              if (newHigh !== prevHigh) {
                localStorage.setItem('rainblocksHighScore', newHigh);
              }
              return newHigh;
            });
            return newScore;
          });
        }
        return filtered;
      });
    },
    [setScore, setHighScore],
  );

  const movePieceHorizontally = useCallback(
    (dir) => {
      setActivePiece((piece) => {
        if (!piece) return piece;
        const newCol = piece.col + dir;
        if (isValidPosition(piece.shape, piece.row, newCol)) {
          return { ...piece, col: newCol };
        }
        return piece;
      });
    },
    [isValidPosition],
  );

  const rotatePiece = useCallback(() => {
    setActivePiece((piece) => {
      if (!piece) return piece;
      const rotated = piece.shape[0].map((_, idx) =>
        piece.shape.map((row) => row[idx]).reverse(),
      );
      if (isValidPosition(rotated, piece.row, piece.col)) {
        return { ...piece, shape: rotated };
      }
      return piece;
    });
  }, [isValidPosition]);

  useEffect(() => {
    if (!gameOverMessage && !activePiece) {
      spawnNewPiece();
    }
  }, [activePiece, gameOverMessage, spawnNewPiece]);

  useEffect(() => {
    if (gameOverMessage) return undefined;
    const intervalId = setInterval(() => {
      setActivePiece((piece) => {
        if (!piece) return piece;
        const newRow = piece.row + 1;
        if (isValidPosition(piece.shape, newRow, piece.col)) {
          return { ...piece, row: newRow };
        }
        lockPiece(piece);
        return null;
      });
    }, 200);
    return () => clearInterval(intervalId);
  }, [gameOverMessage, isValidPosition, lockPiece]);

  useEffect(() => {
    if (gameOverMessage) return undefined;
    const handleKeyDown = (event) => {
      if (!activePieceRef.current) return;
      if (event.key === 'a' || event.key === 'ArrowLeft') {
        event.preventDefault();
        movePieceHorizontally(-1);
      } else if (event.key === 'd' || event.key === 'ArrowRight') {
        event.preventDefault();
        movePieceHorizontally(1);
      } else if (event.key === 'w' || event.key === 'ArrowUp') {
        event.preventDefault();
        rotatePiece();
      } else if (event.key === 's' || event.key === 'ArrowDown') {
        event.preventDefault();
        setActivePiece((piece) => {
          if (!piece) return piece;
          const newRow = piece.row + 1;
          if (isValidPosition(piece.shape, newRow, piece.col)) {
            return { ...piece, row: newRow };
          }
          lockPiece(piece);
          return null;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameOverMessage, movePieceHorizontally, rotatePiece, isValidPosition, lockPiece]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.fillStyle = '#111827';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    board.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell) {
          context.fillStyle = cell;
          context.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      });
    });

    if (activePiece) {
      context.fillStyle = activePiece.color;
      activePiece.shape.forEach((rowArr, r) => {
        rowArr.forEach((cell, c) => {
          if (cell) {
            context.fillRect(
              (activePiece.col + c) * CELL_SIZE,
              (activePiece.row + r) * CELL_SIZE,
              CELL_SIZE,
              CELL_SIZE,
            );
          }
        });
      });
    }
  }, [board, activePiece]);

  useEffect(() => {
    if (!gameOverMessage) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(17, 24, 39, 0.75)';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    return undefined;
  }, [gameOverMessage]);

  return (
    <>
      <BackButton />
      <div className="game-container">
        <h1>Rain Blocks</h1>
        <div className="scoreboard">
          <span>Score: {score}</span>
          <span>High Score: {highScore}</span>
        </div>
        <div className="game-board">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="game-canvas"
          ></canvas>
          {gameOverMessage && (
            <div className="game-overlay">
              <div className="game-overlay-content">
                <p className="game-overlay-title">{gameOverMessage}</p>
                <p className="game-overlay-text">Score: {score}</p>
                <p className="game-overlay-text">High Score: {highScore}</p>
                <p className="game-overlay-text">Try again?</p>
                <button
                  type="button"
                  className="game-overlay-button"
                  onClick={resetGame}
                >
                  Restart
                </button>
                <p className="game-overlay-hint">
                  Use A/D or ←/→ to move, W or ↑ to rotate
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

