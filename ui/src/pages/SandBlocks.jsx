import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './SandBlocks.css';

const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const CELL_SIZE = 32;
const DROP_BASE_INTERVAL = 900;
const DROP_MIN_INTERVAL = 110;
const STORAGE_KEY = 'sandBlocksHighScoreV2';

const COLOR_OPTIONS = ['#f97316', '#38bdf8', '#a855f7', '#facc15', '#22c55e', '#ef4444'];

const SHAPE_DEFS = [
  { name: 'Spire', cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: 'Cradle', cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { name: 'Sunbar', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: 'Ember', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: 'Dune', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: 'Lagoon', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: 'Pillar', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
];

const normalizeCells = (cells) => {
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => [x - minX, y - minY]);
};

const createRotations = (cells) => {
  let current = normalizeCells(cells);
  const rotations = [];

  for (let i = 0; i < 4; i += 1) {
    const normalized = normalizeCells(current);
    const width = Math.max(...normalized.map(([x]) => x)) + 1;
    const height = Math.max(...normalized.map(([, y]) => y)) + 1;
    rotations.push({ cells: normalized, width, height });
    current = normalized.map(([x, y]) => [height - 1 - y, x]);
  }

  return rotations;
};

const SHAPE_LIBRARY = SHAPE_DEFS.map((shape) => ({
  name: shape.name,
  rotations: createRotations(shape.cells),
}));

const createRandomSeed = () => {
  const template = SHAPE_LIBRARY[Math.floor(Math.random() * SHAPE_LIBRARY.length)];
  const rotation = Math.floor(Math.random() * template.rotations.length);
  const color = COLOR_OPTIONS[Math.floor(Math.random() * COLOR_OPTIONS.length)];
  return { template, rotation, color };
};

const spawnPieceFromSeed = (seed) => {
  const rotationIndex = seed.rotation % seed.template.rotations.length;
  const rotation = seed.template.rotations[rotationIndex];
  return {
    template: seed.template,
    rotation: rotationIndex,
    x: Math.floor((BOARD_WIDTH - rotation.width) / 2),
    y: -rotation.height,
    color: seed.color,
  };
};

const createEmptyBoard = () =>
  Array.from({ length: BOARD_HEIGHT }, () => Array.from({ length: BOARD_WIDTH }, () => null));

export default function SandBlocks() {
  const canvasRef = useRef(null);
  const boardRef = useRef(createEmptyBoard());
  const activePieceRef = useRef(null);
  const nextPieceRef = useRef(createRandomSeed());
  const animationRef = useRef(0);
  const lastDropRef = useRef(0);
  const softDropRef = useRef(false);
  const isRunningRef = useRef(false);
  const dropIntervalRef = useRef(DROP_BASE_INTERVAL);
  const levelRef = useRef(1);
  const highScoreRef = useRef(0);

  const [score, setScore] = useState(0);
  const [linesCleared, setLinesCleared] = useState(0);
  const [level, setLevel] = useState(1);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === 'undefined') {
      return 0;
    }

    try {
      const stored = Number.parseInt(window.localStorage.getItem(STORAGE_KEY) ?? '0', 10);
      return Number.isFinite(stored) ? stored : 0;
    } catch {
      return 0;
    }
  });
  const [gameOver, setGameOver] = useState(false);
  const [nextPiece, setNextPiece] = useState(() => nextPieceRef.current);

  useEffect(() => {
    nextPieceRef.current = nextPiece;
  }, [nextPiece]);

  useEffect(() => {
    highScoreRef.current = highScore;
  }, [highScore]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = BOARD_WIDTH * CELL_SIZE;
    canvas.height = BOARD_HEIGHT * CELL_SIZE;
  }, []);

  const persistHighScore = useCallback((value) => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // ignore storage failures
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= BOARD_WIDTH; x += 1) {
      const px = x * CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= BOARD_HEIGHT; y += 1) {
      const py = y * CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(0, py + 0.5);
      ctx.lineTo(canvas.width, py + 0.5);
      ctx.stroke();
    }

    const drawCell = (x, y, color) => {
      const px = x * CELL_SIZE;
      const py = y * CELL_SIZE;
      ctx.fillStyle = color;
      ctx.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(px + 2, py + 2, CELL_SIZE - 4, Math.ceil((CELL_SIZE - 2) / 3));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
      ctx.fillRect(px + 2, py + CELL_SIZE - 4, CELL_SIZE - 4, 3);
    };

    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const cell = boardRef.current[y][x];
        if (cell) {
          drawCell(x, y, cell.color);
        }
      }
    }

    const activePiece = activePieceRef.current;
    if (activePiece) {
      const rotation = activePiece.template.rotations[activePiece.rotation];
      rotation.cells.forEach(([dx, dy]) => {
        const x = activePiece.x + dx;
        const y = activePiece.y + dy;
        if (y < 0 || y >= BOARD_HEIGHT || x < 0 || x >= BOARD_WIDTH) {
          return;
        }
        drawCell(x, y, activePiece.color);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * CELL_SIZE + 1.5, y * CELL_SIZE + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
      });
    }
  }, []);

  const addScore = useCallback(
    (points) => {
      if (points <= 0) {
        return;
      }
      setScore((prev) => {
        const total = prev + points;
        if (total > highScoreRef.current) {
          highScoreRef.current = total;
          setHighScore(total);
          persistHighScore(total);
        }
        return total;
      });
    },
    [persistHighScore]
  );

  const adjustLevel = useCallback((totalLines) => {
    const nextLevel = Math.min(15, Math.floor(totalLines / 5) + 1);
    if (nextLevel !== levelRef.current) {
      levelRef.current = nextLevel;
      setLevel(nextLevel);
      dropIntervalRef.current = Math.max(DROP_BASE_INTERVAL - (nextLevel - 1) * 70, DROP_MIN_INTERVAL);
    }
  }, []);

  const awardLineClear = useCallback(
    (rowsCleared) => {
      if (rowsCleared === 0) {
        return;
      }

      setLinesCleared((prev) => {
        const total = prev + rowsCleared;
        adjustLevel(total);
        return total;
      });

      const baseScores = [0, 120, 260, 420, 640];
      const gained = (baseScores[rowsCleared] ?? rowsCleared * 220) * levelRef.current;
      addScore(gained);
    },
    [addScore, adjustLevel]
  );

  const canPlace = useCallback((piece, offsetX = 0, offsetY = 0) => {
    const rotation = piece.template.rotations[piece.rotation];
    return rotation.cells.every(([dx, dy]) => {
      const x = piece.x + offsetX + dx;
      const y = piece.y + offsetY + dy;
      if (x < 0 || x >= BOARD_WIDTH) {
        return false;
      }
      if (y >= BOARD_HEIGHT) {
        return false;
      }
      if (y < 0) {
        return true;
      }
      return !boardRef.current[y][x];
    });
  }, []);

  const handleGameOver = useCallback(() => {
    if (!isRunningRef.current) {
      return;
    }
    isRunningRef.current = false;
    softDropRef.current = false;
    activePieceRef.current = null;
    setGameOver(true);
  }, []);

  const spawnNextFromQueue = useCallback(() => {
    if (!isRunningRef.current) {
      return;
    }

    const queued = nextPieceRef.current ?? createRandomSeed();
    const piece = spawnPieceFromSeed(queued);
    if (!canPlace(piece)) {
      handleGameOver();
      return;
    }

    activePieceRef.current = piece;
    const upcoming = createRandomSeed();
    nextPieceRef.current = upcoming;
    setNextPiece(upcoming);
  }, [canPlace, handleGameOver]);

  const lockPiece = useCallback(() => {
    const piece = activePieceRef.current;
    if (!piece) {
      return;
    }

    const rotation = piece.template.rotations[piece.rotation];
    for (let i = 0; i < rotation.cells.length; i += 1) {
      const [dx, dy] = rotation.cells[i];
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (y < 0) {
        handleGameOver();
        return;
      }
      if (y >= 0 && y < BOARD_HEIGHT && x >= 0 && x < BOARD_WIDTH) {
        boardRef.current[y][x] = { color: piece.color };
      }
    }

    addScore(8 * levelRef.current);
    activePieceRef.current = null;
    spawnNextFromQueue();
  }, [addScore, handleGameOver, spawnNextFromQueue]);

  const advancePiece = useCallback(() => {
    if (!isRunningRef.current) {
      return;
    }

    if (!activePieceRef.current) {
      spawnNextFromQueue();
      return;
    }

    const piece = activePieceRef.current;
    if (canPlace(piece, 0, 1)) {
      piece.y += 1;
    } else {
      lockPiece();
    }
  }, [canPlace, lockPiece, spawnNextFromQueue]);

  const stepSand = useCallback(() => {
    if (!isRunningRef.current) {
      return false;
    }

    let moved = false;
    for (let y = BOARD_HEIGHT - 2; y >= 0; y -= 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const cell = boardRef.current[y][x];
        if (!cell) {
          continue;
        }

        const below = boardRef.current[y + 1][x];
        if (!below) {
          boardRef.current[y + 1][x] = cell;
          boardRef.current[y][x] = null;
          moved = true;
          continue;
        }

        const leftClear = x > 0 && !boardRef.current[y + 1][x - 1];
        const rightClear = x < BOARD_WIDTH - 1 && !boardRef.current[y + 1][x + 1];

        if (leftClear && rightClear) {
          const direction = Math.random() < 0.5 ? -1 : 1;
          boardRef.current[y + 1][x + direction] = cell;
          boardRef.current[y][x] = null;
          moved = true;
        } else if (leftClear) {
          boardRef.current[y + 1][x - 1] = cell;
          boardRef.current[y][x] = null;
          moved = true;
        } else if (rightClear) {
          boardRef.current[y + 1][x + 1] = cell;
          boardRef.current[y][x] = null;
          moved = true;
        }
      }
    }

    return moved;
  }, []);

  const clearCompleteRows = useCallback(() => {
    let cleared = 0;
    for (let y = BOARD_HEIGHT - 1; y >= 0; y -= 1) {
      const row = boardRef.current[y];
      if (!row.every((cell) => cell)) {
        continue;
      }
      const targetColor = row[0]?.color;
      if (!row.every((cell) => cell?.color === targetColor)) {
        continue;
      }

      boardRef.current.splice(y, 1);
      boardRef.current.unshift(Array.from({ length: BOARD_WIDTH }, () => null));
      cleared += 1;
      y += 1;
    }

    return cleared;
  }, []);

  const runFrame = useCallback(
    (timestamp) => {
      if (!lastDropRef.current) {
        lastDropRef.current = timestamp;
      }

      if (isRunningRef.current) {
        const dropInterval = softDropRef.current
          ? Math.max(60, dropIntervalRef.current / 6)
          : dropIntervalRef.current;

        if (timestamp - lastDropRef.current >= dropInterval) {
          advancePiece();
          lastDropRef.current = timestamp;
        }

        for (let i = 0; i < 3; i += 1) {
          const moved = stepSand();
          if (!moved) {
            break;
          }
        }

        const cleared = clearCompleteRows();
        if (cleared) {
          awardLineClear(cleared);
        }
      }

      draw();
      animationRef.current = requestAnimationFrame(runFrame);
    },
    [advancePiece, awardLineClear, clearCompleteRows, draw, stepSand]
  );

  useEffect(() => {
    animationRef.current = requestAnimationFrame(runFrame);
    return () => cancelAnimationFrame(animationRef.current);
  }, [runFrame]);

  const startNewGame = useCallback(() => {
    boardRef.current = createEmptyBoard();
    setScore(0);
    setLinesCleared(0);
    setLevel(1);
    levelRef.current = 1;
    dropIntervalRef.current = DROP_BASE_INTERVAL;
    softDropRef.current = false;
    lastDropRef.current = 0;
    setGameOver(false);

    const firstSeed = createRandomSeed();
    const previewSeed = createRandomSeed();
    const firstPiece = spawnPieceFromSeed(firstSeed);

    if (!canPlace(firstPiece)) {
      handleGameOver();
      return;
    }

    activePieceRef.current = firstPiece;
    nextPieceRef.current = previewSeed;
    setNextPiece(previewSeed);

    isRunningRef.current = true;
    draw();
  }, [canPlace, draw, handleGameOver]);

  useEffect(() => {
    startNewGame();
  }, [startNewGame]);

  const movePiece = useCallback(
    (direction) => {
      if (!isRunningRef.current) {
        return;
      }
      const piece = activePieceRef.current;
      if (!piece) {
        return;
      }
      if (canPlace(piece, direction, 0)) {
        piece.x += direction;
        draw();
      }
    },
    [canPlace, draw]
  );

  const rotatePiece = useCallback(
    (direction = 1) => {
      if (!isRunningRef.current) {
        return;
      }
      const piece = activePieceRef.current;
      if (!piece) {
        return;
      }
      const newRotation = (piece.rotation + direction + 4) % 4;
      const trial = {
        ...piece,
        rotation: newRotation,
      };
      const kicks = [0, -1, 1, -2, 2];
      for (let i = 0; i < kicks.length; i += 1) {
        trial.x = piece.x + kicks[i];
        trial.y = piece.y;
        if (canPlace(trial, 0, 0)) {
          piece.x = trial.x;
          piece.rotation = newRotation;
          draw();
          return;
        }
      }
    },
    [canPlace, draw]
  );

  const hardDrop = useCallback(() => {
    if (!isRunningRef.current) {
      return;
    }
    const piece = activePieceRef.current;
    if (!piece) {
      return;
    }
    while (canPlace(piece, 0, 1)) {
      piece.y += 1;
    }
    lockPiece();
    lastDropRef.current = 0;
    draw();
  }, [canPlace, draw, lockPiece]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        startNewGame();
        return;
      }

      if (!isRunningRef.current) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          event.preventDefault();
          movePiece(-1);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          event.preventDefault();
          movePiece(1);
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
          event.preventDefault();
          rotatePiece(1);
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          event.preventDefault();
          softDropRef.current = true;
          break;
        case ' ':
          event.preventDefault();
          hardDrop();
          break;
        default:
      }
    };

    const handleKeyUp = (event) => {
      if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') {
        softDropRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [hardDrop, movePiece, rotatePiece, startNewGame]);

  const previewMatrix = useMemo(() => {
    if (!nextPiece) {
      return [];
    }
    const rotation = nextPiece.template.rotations[nextPiece.rotation];
    const size = Math.max(4, rotation.width, rotation.height);
    const matrix = Array.from({ length: size }, () => Array(size).fill(false));
    rotation.cells.forEach(([x, y]) => {
      if (y < size && x < size) {
        matrix[y][x] = true;
      }
    });
    return matrix;
  }, [nextPiece]);

  return (
    <div className="sand-wrapper">
      <BackButton to="/games" label="Back to games" />
      <div className="sand-content">
        <header className="sand-header">
          <h1>Sand Blocks</h1>
          <p>Guide falling bricks that crumble into sand, settle into dunes, and fuse matching layers to clear the board.</p>
        </header>

        <div className="sand-layout">
          <div className="sand-board">
            <canvas ref={canvasRef} className="sand-canvas" aria-label="Sand Blocks playfield" />
            {gameOver && (
              <div className="sand-overlay" role="alert">
                <h2>Game Over</h2>
                <p>The dunes reached the sky. Try again to sculpt smoother layers!</p>
                <button type="button" className="sand-button" onClick={startNewGame}>
                  Restart
                </button>
              </div>
            )}
          </div>

          <aside className="sand-sidebar">
            <div className="sand-score-grid">
              <div className="sand-score-card">
                <span className="sand-score-label">Score</span>
                <span className="sand-score-value">{score.toLocaleString()}</span>
              </div>
              <div className="sand-score-card">
                <span className="sand-score-label">High Score</span>
                <span className="sand-score-value">{highScore.toLocaleString()}</span>
              </div>
              <div className="sand-score-card">
                <span className="sand-score-label">Lines</span>
                <span className="sand-score-value">{linesCleared.toLocaleString()}</span>
              </div>
              <div className="sand-score-card">
                <span className="sand-score-label">Level</span>
                <span className="sand-score-value">{level}</span>
              </div>
            </div>

            <div className="sand-preview">
              <div className="sand-preview-header">
                <h2>Next Shape</h2>
                <span>{nextPiece?.template.name}</span>
              </div>
              <div className="sand-preview-grid">
                {previewMatrix.map((row, rowIndex) => (
                  <div key={`row-${rowIndex}`} className="sand-preview-row">
                    {row.map((filled, colIndex) => (
                      <div
                        // eslint-disable-next-line react/no-array-index-key
                        key={`cell-${rowIndex}-${colIndex}`}
                        className={`sand-preview-cell${filled ? ' filled' : ''}`}
                        style={filled ? { backgroundColor: nextPiece.color } : undefined}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="sand-controls">
              <button type="button" className="sand-button" onClick={startNewGame}>
                Restart Run
              </button>
              <div className="sand-keymap">
                <p>Controls</p>
                <ul>
                  <li><kbd>←</kbd>/<kbd>→</kbd> — Slide</li>
                  <li><kbd>↑</kbd> — Rotate</li>
                  <li><kbd>↓</kbd> — Soft drop</li>
                  <li><kbd>Space</kbd> — Hard drop</li>
                  <li><kbd>Enter</kbd> — Quick restart</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
