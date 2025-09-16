import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './RainBlocks.css';

export const CELL_SIZE = 24;
export const BOARD_COLUMNS = 10;
export const BOARD_ROWS = 20;
export const CANVAS_WIDTH = BOARD_COLUMNS * CELL_SIZE;
export const CANVAS_HEIGHT = BOARD_ROWS * CELL_SIZE;
const LOCK_DELAY_MS = 300;
const PREVIEW_GRID_SIZE = 4;

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

const cloneShape = (shape) => shape.map((row) => row.slice());

const createPreviewMatrix = (piece) => {
  const grid = Array.from({ length: PREVIEW_GRID_SIZE }, () =>
    Array(PREVIEW_GRID_SIZE).fill(null),
  );
  if (!piece) {
    return grid;
  }

  const pieceRows = piece.shape.length;
  const pieceCols = piece.shape[0].length;
  const rowOffset = Math.max(0, Math.floor((PREVIEW_GRID_SIZE - pieceRows) / 2));
  const colOffset = Math.max(0, Math.floor((PREVIEW_GRID_SIZE - pieceCols) / 2));

  piece.shape.forEach((rowArr, r) => {
    rowArr.forEach((cell, c) => {
      if (!cell) {
        return;
      }
      const targetRow = rowOffset + r;
      const targetCol = colOffset + c;
      if (
        targetRow >= 0 &&
        targetRow < PREVIEW_GRID_SIZE &&
        targetCol >= 0 &&
        targetCol < PREVIEW_GRID_SIZE
      ) {
        grid[targetRow][targetCol] = piece.color;
      }
    });
  });

  return grid;
};

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
  const [linesCleared, setLinesCleared] = useState(0);
  const [level, setLevel] = useState(1);
  const [heldPiece, setHeldPiece] = useState(null);
  const [hasHeldThisDrop, setHasHeldThisDrop] = useState(false);

  const LINES_PER_LEVEL = 10;

  const boardRef = useRef(board);
  const activePieceRef = useRef(activePiece);
  const heldPieceRef = useRef(heldPiece);
  const hasHeldThisDropRef = useRef(hasHeldThisDrop);
  const lockDelayRef = useRef(null);
  const levelRef = useRef(level);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    activePieceRef.current = activePiece;
  }, [activePiece]);
  useEffect(() => {
    heldPieceRef.current = heldPiece;
  }, [heldPiece]);
  useEffect(() => {
    hasHeldThisDropRef.current = hasHeldThisDrop;
  }, [hasHeldThisDrop]);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  const clearLockDelay = useCallback(() => {
    if (lockDelayRef.current) {
      clearTimeout(lockDelayRef.current);
      lockDelayRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearLockDelay();
    },
    [clearLockDelay],
  );

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

  const spawnNewPiece = useCallback(
    (resetHold = true) => {
      clearLockDelay();
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
      if (resetHold) {
        setHasHeldThisDrop(false);
        hasHeldThisDropRef.current = false;
      }
      return true;
    },
    [clearLockDelay, hasHeldThisDropRef, isValidPosition],
  );

  const resetGame = useCallback(() => {
    clearLockDelay();
    const freshBoard = createEmptyBoard();
    boardRef.current = freshBoard;
    setBoard(freshBoard);
    activePieceRef.current = null;
    setActivePiece(null);
    heldPieceRef.current = null;
    setHeldPiece(null);
    hasHeldThisDropRef.current = false;
    setHasHeldThisDrop(false);
    setGameOverMessage(null);
    setScore(0);
    setLinesCleared(0);
    setLevel(1);
    spawnNewPiece();
  }, [clearLockDelay, spawnNewPiece]);

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
        const currentLevel = levelRef.current;
        const piecePoints = 10 * currentLevel;
        const linePoints = cleared * 100 * currentLevel;
        setScore((prevScore) => {
          const newScore = prevScore + piecePoints + linePoints;
          setHighScore((prevHigh) => {
            const newHigh = Math.max(prevHigh, newScore);
            if (newHigh !== prevHigh) {
              localStorage.setItem('rainblocksHighScore', newHigh);
            }
            return newHigh;
          });
          return newScore;
        });
        if (cleared > 0) {
          setLinesCleared((prev) => {
            const total = prev + cleared;
            const newLevel = Math.min(20, Math.floor(total / LINES_PER_LEVEL) + 1);
            setLevel(newLevel);
            return total;
          });
        }
        return filtered;
      });
    },
    [setScore, setHighScore, setLinesCleared, setLevel],
  );

  const scheduleLock = useCallback(() => {
    if (lockDelayRef.current) {
      return;
    }
    lockDelayRef.current = setTimeout(() => {
      lockDelayRef.current = null;
      const piece = activePieceRef.current;
      if (!piece) {
        return;
      }
      if (isValidPosition(piece.shape, piece.row + 1, piece.col)) {
        return;
      }
      lockPiece(piece);
      activePieceRef.current = null;
      setActivePiece(null);
    }, LOCK_DELAY_MS);
  }, [isValidPosition, lockPiece]);

  const movePieceHorizontally = useCallback(
    (dir) => {
      setActivePiece((piece) => {
        if (!piece) return piece;
        const newCol = piece.col + dir;
        if (isValidPosition(piece.shape, piece.row, newCol)) {
          clearLockDelay();
          return { ...piece, col: newCol };
        }
        return piece;
      });
    },
    [clearLockDelay, isValidPosition],
  );

  const rotatePiece = useCallback(() => {
    setActivePiece((piece) => {
      if (!piece) return piece;
      const rotated = piece.shape[0].map((_, idx) =>
        piece.shape.map((row) => row[idx]).reverse(),
      );
      if (isValidPosition(rotated, piece.row, piece.col)) {
        clearLockDelay();
        return { ...piece, shape: rotated };
      }
      return piece;
    });
  }, [clearLockDelay, isValidPosition]);

  const holdCurrentPiece = useCallback(() => {
    const piece = activePieceRef.current;
    if (!piece || hasHeldThisDropRef.current) {
      return;
    }
    clearLockDelay();
    const holdData = {
      shape: cloneShape(piece.shape),
      color: piece.color,
    };

    if (!heldPieceRef.current) {
      setHeldPiece(holdData);
      setHasHeldThisDrop(true);
      hasHeldThisDropRef.current = true;
      activePieceRef.current = null;
      setActivePiece(null);
      spawnNewPiece(false);
      return;
    }

    const held = heldPieceRef.current;
    const spawnRow = 0;
    const spawnCol = Math.floor(
      (BOARD_COLUMNS - held.shape[0].length) / 2,
    );

    if (!isValidPosition(held.shape, spawnRow, spawnCol)) {
      return;
    }

    const swappedPiece = {
      row: spawnRow,
      col: spawnCol,
      shape: cloneShape(held.shape),
      color: held.color,
    };

    setHeldPiece(holdData);
    setHasHeldThisDrop(true);
    hasHeldThisDropRef.current = true;
    activePieceRef.current = swappedPiece;
    setActivePiece(swappedPiece);
  }, [
    activePieceRef,
    clearLockDelay,
    hasHeldThisDropRef,
    heldPieceRef,
    isValidPosition,
    spawnNewPiece,
  ]);

  useEffect(() => {
    if (!gameOverMessage && !activePiece) {
      spawnNewPiece();
    }
  }, [activePiece, gameOverMessage, spawnNewPiece]);

  useEffect(() => {
    if (gameOverMessage) return undefined;
    const interval = Math.max(100, 500 - (level - 1) * 20);
    const intervalId = setInterval(() => {
      setActivePiece((piece) => {
        if (!piece) return piece;
        const newRow = piece.row + 1;
        if (isValidPosition(piece.shape, newRow, piece.col)) {
          clearLockDelay();
          return { ...piece, row: newRow };
        }
        scheduleLock();
        return piece;
      });
    }, interval);
    return () => clearInterval(intervalId);
  }, [
    clearLockDelay,
    gameOverMessage,
    isValidPosition,
    scheduleLock,
    level,
  ]);

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
            clearLockDelay();
            return { ...piece, row: newRow };
          }
          scheduleLock();
          return piece;
        });
      } else if (
        event.key === 'Shift' ||
        event.key === 'ShiftLeft' ||
        event.key === 'ShiftRight' ||
        event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        holdCurrentPiece();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    clearLockDelay,
    gameOverMessage,
    isValidPosition,
    movePieceHorizontally,
    holdCurrentPiece,
    rotatePiece,
    scheduleLock,
  ]);

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
      let ghostRow = activePiece.row;
      while (isValidPosition(activePiece.shape, ghostRow + 1, activePiece.col)) {
        ghostRow += 1;
      }
      if (ghostRow !== activePiece.row) {
        context.save();
        context.globalAlpha = 0.35;
        context.fillStyle = activePiece.color;
        activePiece.shape.forEach((rowArr, r) => {
          rowArr.forEach((cell, c) => {
            if (cell) {
              context.fillRect(
                (activePiece.col + c) * CELL_SIZE,
                (ghostRow + r) * CELL_SIZE,
                CELL_SIZE,
                CELL_SIZE,
              );
            }
          });
        });
        context.restore();
      }

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
  }, [activePiece, board, isValidPosition]);

  useEffect(() => {
    if (!gameOverMessage) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(17, 24, 39, 0.75)';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    return undefined;
  }, [gameOverMessage]);

  const holdPreviewMatrix = createPreviewMatrix(heldPiece);

  return (
    <>
      <BackButton />
      <div className="game-container">
        <h1>Rain Blocks</h1>
        <div className="scoreboard">
          <span>Score: {score}</span>
          <span>High Score: {highScore}</span>
          <span>Lines: {linesCleared}</span>
          <span>Level: {level}</span>
        </div>
        <div className="playfield">
          <div className="side-panel hold-panel">
            <h2 className="panel-title">Hold</h2>
            <div className="piece-preview">
              {holdPreviewMatrix.map((row, rowIndex) =>
                row.map((cell, cellIndex) => (
                  <div
                    key={`hold-${rowIndex}-${cellIndex}`}
                    className={`piece-preview-cell${cell ? ' filled' : ''}`}
                    style={cell ? { backgroundColor: cell } : undefined}
                  ></div>
                ))
              )}
              {!heldPiece && (
                <span className="piece-preview-empty">Empty</span>
              )}
            </div>
            <p className="panel-hint">
              {hasHeldThisDrop
                ? 'Hold used - lock a piece to reset'
                : 'Shift or C to hold'}
            </p>
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
                  <p className="game-overlay-text">Lines: {linesCleared}</p>
                  <p className="game-overlay-text">Level: {level}</p>
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
                    Use A/D or ←/→ to move, W or ↑ to rotate, Shift or C to hold
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

