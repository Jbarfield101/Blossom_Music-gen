import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './RainBlocks.css';

export const CELL_SIZE = 24;
export const BOARD_COLUMNS = 10;
export const BOARD_ROWS = 20;
export const CANVAS_WIDTH = BOARD_COLUMNS * CELL_SIZE;
export const CANVAS_HEIGHT = BOARD_ROWS * CELL_SIZE;
const PREVIEW_GRID_SIZE = 4;
const PREVIEW_CELL_SIZE = 20;
const PREVIEW_CANVAS_SIZE = PREVIEW_GRID_SIZE * PREVIEW_CELL_SIZE;
const LOCK_DELAY_MS = 300;
const HARD_DROP_POINTS_PER_ROW = 2;

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

const getRandomShape = () => {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  return {
    color: shape.color,
    matrix: shape.matrix,
  };
};

export default function RainBlocks() {
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const heldCanvasRef = useRef(null);
  const [board, setBoard] = useState(() => createEmptyBoard());
  const [activePiece, setActivePiece] = useState(null);
  const [nextPiece, setNextPiece] = useState(() => getRandomShape());
  const [heldPiece, setHeldPiece] = useState(null);
  const [gameOverMessage, setGameOverMessage] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const stored = Number(localStorage.getItem('rainblocksHighScore'));
    return Number.isNaN(stored) ? 0 : stored;
  });
  const [linesCleared, setLinesCleared] = useState(0);
  const [level, setLevel] = useState(1);
  const [holdUsed, setHoldUsed] = useState(false);

  const LINES_PER_LEVEL = 10;

  const boardRef = useRef(board);
  const activePieceRef = useRef(activePiece);
  const nextPieceRef = useRef(nextPiece);
  const heldPieceRef = useRef(heldPiece);
  const lockDelayRef = useRef(null);
  const levelRef = useRef(level);
  const holdUsedRef = useRef(holdUsed);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    activePieceRef.current = activePiece;
  }, [activePiece]);
  useEffect(() => {
    nextPieceRef.current = nextPiece;
  }, [nextPiece]);
  useEffect(() => {
    heldPieceRef.current = heldPiece;
  }, [heldPiece]);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  useEffect(() => {
    holdUsedRef.current = holdUsed;
  }, [holdUsed]);

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

  const spawnNewPiece = useCallback(() => {
    clearLockDelay();
    const incoming = nextPieceRef.current ?? getRandomShape();
    const startCol = Math.floor(
      (BOARD_COLUMNS - incoming.matrix[0].length) / 2,
    );

    if (!isValidPosition(incoming.matrix, 0, startCol)) {
      setGameOverMessage('Game Over');
      activePieceRef.current = null;
      setActivePiece(null);
      return false;
    }

    const piece = {
      row: 0,
      col: startCol,
      shape: incoming.matrix,
      color: incoming.color,
    };
    activePieceRef.current = piece;
    setActivePiece(piece);

    const replacement = getRandomShape();
    nextPieceRef.current = replacement;
    setNextPiece(replacement);
    return true;
  }, [clearLockDelay, isValidPosition]);

  const resetGame = useCallback(() => {
    clearLockDelay();
    const freshBoard = createEmptyBoard();
    boardRef.current = freshBoard;
    setBoard(freshBoard);
    activePieceRef.current = null;
    setActivePiece(null);
    heldPieceRef.current = null;
    setHeldPiece(null);
    setGameOverMessage(null);
    setScore(0);
    setLinesCleared(0);
    setLevel(1);
    setHoldUsed(false);
    holdUsedRef.current = false;
    const initialNext = getRandomShape();
    nextPieceRef.current = initialNext;
    setNextPiece(initialNext);
    spawnNewPiece();
  }, [clearLockDelay, spawnNewPiece]);

  const adjustScore = useCallback(
    (delta) => {
      if (delta === 0) {
        return;
      }
      setScore((prevScore) => {
        const newScore = prevScore + delta;
        setHighScore((prevHigh) => {
          const newHigh = Math.max(prevHigh, newScore);
          if (newHigh !== prevHigh) {
            localStorage.setItem('rainblocksHighScore', newHigh);
          }
          return newHigh;
        });
        return newScore;
      });
    },
    [setHighScore, setScore],
  );

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
        adjustScore(piecePoints + linePoints);
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
      setHoldUsed(false);
      holdUsedRef.current = false;
    },
    [adjustScore, setLinesCleared, setLevel],
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

  const handleHoldPiece = useCallback(() => {
    const currentPiece = activePieceRef.current;
    if (!currentPiece || holdUsedRef.current) {
      return;
    }
    clearLockDelay();
    const currentHold = heldPieceRef.current;
    if (currentHold) {
      const startCol = Math.floor(
        (BOARD_COLUMNS - currentHold.matrix[0].length) / 2,
      );
      if (!isValidPosition(currentHold.matrix, 0, startCol)) {
        return;
      }
      const nextActive = {
        row: 0,
        col: startCol,
        shape: currentHold.matrix.map((row) => row.slice()),
        color: currentHold.color,
      };
      const stored = {
        color: currentPiece.color,
        matrix: currentPiece.shape.map((row) => row.slice()),
      };
      heldPieceRef.current = stored;
      setHeldPiece(stored);
      activePieceRef.current = nextActive;
      setActivePiece(nextActive);
      setHoldUsed(true);
      holdUsedRef.current = true;
      return;
    }

    const stored = {
      color: currentPiece.color,
      matrix: currentPiece.shape.map((row) => row.slice()),
    };
    heldPieceRef.current = stored;
    setHeldPiece(stored);
    activePieceRef.current = null;
    setActivePiece(null);
    setHoldUsed(true);
    holdUsedRef.current = true;
    spawnNewPiece();
  }, [clearLockDelay, isValidPosition, spawnNewPiece]);

  const handleHardDrop = useCallback(() => {
    const currentPiece = activePieceRef.current;
    if (!currentPiece) {
      return;
    }
    clearLockDelay();
    let dropRow = currentPiece.row;
    while (isValidPosition(currentPiece.shape, dropRow + 1, currentPiece.col)) {
      dropRow += 1;
    }
    const distance = dropRow - currentPiece.row;
    if (distance > 0) {
      const dropBonus =
        distance * levelRef.current * HARD_DROP_POINTS_PER_ROW;
      adjustScore(dropBonus);
    }
    const droppedPiece = {
      ...currentPiece,
      row: dropRow,
    };
    lockPiece(droppedPiece);
    activePieceRef.current = null;
    setActivePiece(null);
  }, [
    adjustScore,
    clearLockDelay,
    isValidPosition,
    lockPiece,
    setActivePiece,
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
      } else if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        handleHardDrop();
      } else if (
        event.key === 'Shift' ||
        event.key === 'c' ||
        event.key === 'C'
      ) {
        event.preventDefault();
        handleHoldPiece();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    clearLockDelay,
    gameOverMessage,
    isValidPosition,
    movePieceHorizontally,
    rotatePiece,
    scheduleLock,
    handleHoldPiece,
    handleHardDrop,
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
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas) return;
    const context = previewCanvas.getContext('2d');
    context.clearRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);
    context.fillStyle = '#111827';
    context.fillRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);

    if (!nextPiece) {
      return;
    }

    const { matrix, color } = nextPiece;
    const rows = matrix.length;
    const cols = matrix[0].length;
    const offsetRow = Math.floor((PREVIEW_GRID_SIZE - rows) / 2);
    const offsetCol = Math.floor((PREVIEW_GRID_SIZE - cols) / 2);

    context.fillStyle = color;
    matrix.forEach((rowArr, r) => {
      rowArr.forEach((cell, c) => {
        if (cell) {
          context.fillRect(
            (offsetCol + c) * PREVIEW_CELL_SIZE,
            (offsetRow + r) * PREVIEW_CELL_SIZE,
            PREVIEW_CELL_SIZE,
            PREVIEW_CELL_SIZE,
          );
        }
      });
    });
  }, [nextPiece]);

  useEffect(() => {
    const holdCanvas = heldCanvasRef.current;
    if (!holdCanvas) return;
    const context = holdCanvas.getContext('2d');
    context.clearRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);
    context.fillStyle = '#111827';
    context.fillRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);

    if (!heldPiece) {
      return;
    }

    const { matrix, color } = heldPiece;
    const rows = matrix.length;
    const cols = matrix[0].length;
    const offsetRow = Math.floor((PREVIEW_GRID_SIZE - rows) / 2);
    const offsetCol = Math.floor((PREVIEW_GRID_SIZE - cols) / 2);

    context.fillStyle = color;
    matrix.forEach((rowArr, r) => {
      rowArr.forEach((cell, c) => {
        if (cell) {
          context.fillRect(
            (offsetCol + c) * PREVIEW_CELL_SIZE,
            (offsetRow + r) * PREVIEW_CELL_SIZE,
            PREVIEW_CELL_SIZE,
            PREVIEW_CELL_SIZE,
          );
        }
      });
    });
  }, [heldPiece]);

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
        <div className="game-layout">
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
                    Use A/D or ←/→ to move, W or ↑ to rotate, S or ↓ to drop
                    faster, Space to slam, Shift or C to hold
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="game-sidebar">
            <div className="scoreboard sidebar-card">
              <span>Score: {score}</span>
              <span>High Score: {highScore}</span>
              <span>Lines: {linesCleared}</span>
              <span>Level: {level}</span>
            </div>
            <div className="hold-container sidebar-card">
              <p className="hold-title">Hold</p>
              <canvas
                ref={heldCanvasRef}
                width={PREVIEW_CANVAS_SIZE}
                height={PREVIEW_CANVAS_SIZE}
                className="hold-canvas"
              ></canvas>
            </div>
            <div className="preview-container sidebar-card">
              <p className="preview-title">Next</p>
              <canvas
                ref={previewCanvasRef}
                width={PREVIEW_CANVAS_SIZE}
                height={PREVIEW_CANVAS_SIZE}
                className="preview-canvas"
              ></canvas>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

