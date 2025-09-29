import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './SandBlocks.css';

const CELL_SIZE = 6;
const GRID_WIDTH = 120;
const GRID_HEIGHT = 80;
const CANVAS_WIDTH = GRID_WIDTH * CELL_SIZE;
const CANVAS_HEIGHT = GRID_HEIGHT * CELL_SIZE;
const STORAGE_KEY = 'sandBlocksHighScore';

const createEmptyGrid = () =>
  Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill(0));

export default function SandBlocks() {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const gridRef = useRef(createEmptyGrid());
  const startTimeRef = useRef(null);
  const isDrawingRef = useRef({ active: false, erase: false });
  const isRunningRef = useRef(false);

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [grainCount, setGrainCount] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === 'undefined') {
      return 0;
    }

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const parsed = Number.parseFloat(stored);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  });

  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#fbbf24';
    const grid = gridRef.current;
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        if (grid[y][x] !== 1) {
          continue;
        }

        ctx.fillRect(
          x * CELL_SIZE,
          y * CELL_SIZE,
          CELL_SIZE,
          CELL_SIZE
        );
      }
    }
  }, []);

  const countGrains = useCallback(() => {
    const grid = gridRef.current;
    let count = 0;
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        if (grid[y][x] === 1) {
          count += 1;
        }
      }
    }
    setGrainCount(count);
  }, []);

  const stepSimulation = useCallback(() => {
    const currentGrid = gridRef.current;
    const nextGrid = currentGrid.map((row) => row.slice());
    let moved = false;

    for (let y = GRID_HEIGHT - 2; y >= 0; y -= 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        if (currentGrid[y][x] !== 1) {
          continue;
        }

        const belowY = y + 1;
        if (currentGrid[belowY][x] === 0) {
          nextGrid[belowY][x] = 1;
          nextGrid[y][x] = 0;
          moved = true;
          continue;
        }

        const candidates = [];
        if (x > 0 && currentGrid[belowY][x - 1] === 0) {
          candidates.push(x - 1);
        }
        if (x < GRID_WIDTH - 1 && currentGrid[belowY][x + 1] === 0) {
          candidates.push(x + 1);
        }

        if (candidates.length === 0) {
          continue;
        }

        const choice = candidates[Math.floor(Math.random() * candidates.length)];
        nextGrid[belowY][choice] = 1;
        nextGrid[y][x] = 0;
        moved = true;
      }
    }

    if (moved) {
      gridRef.current = nextGrid;
    }

    return moved;
  }, []);

  const updateAnimation = useCallback(
    (timestamp) => {
      if (!isRunningRef.current) {
        return;
      }

      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const hasMoved = stepSimulation();
      drawGrid();

      if (grainCount > 0 && startTimeRef.current) {
        const elapsedSeconds = (timestamp - startTimeRef.current) / 1000;
        setElapsedTime(elapsedSeconds);
        setHighScore((prev) =>
          elapsedSeconds > prev ? Number(elapsedSeconds.toFixed(2)) : prev
        );
      } else if (grainCount === 0) {
        startTimeRef.current = timestamp;
        setElapsedTime(0);
      }

      if (!hasMoved && grainCount === 0) {
        startTimeRef.current = timestamp;
      }

      animationFrameRef.current = window.requestAnimationFrame(updateAnimation);
    },
    [drawGrid, grainCount, stepSimulation]
  );

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      return undefined;
    }

    animationFrameRef.current = window.requestAnimationFrame(updateAnimation);
    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRunning, updateAnimation]);

  useEffect(() => {
    drawGrid();
  }, [drawGrid]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, String(highScore));
    } catch {
      // Ignore persistence failures.
    }
  }, [highScore]);

  const resetBoard = useCallback(() => {
    gridRef.current = createEmptyGrid();
    drawGrid();
    countGrains();
    startTimeRef.current = null;
    setElapsedTime(0);
  }, [countGrains, drawGrid]);

  const handleStart = useCallback(() => {
    startTimeRef.current = null;
    setIsRunning(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    resetBoard();
  }, [resetBoard]);

  const applyAtPosition = useCallback((clientX, clientY, erase = false) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor(((clientX - rect.left) * scaleX) / CELL_SIZE);
    const y = Math.floor(((clientY - rect.top) * scaleY) / CELL_SIZE);

    if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) {
      return;
    }

    const grid = gridRef.current;
    const current = grid[y][x];
    if (!erase && current === 1) {
      return;
    }
    if (erase && current === 0) {
      return;
    }

    grid[y][x] = erase ? 0 : 1;
    drawGrid();
    countGrains();
  }, [countGrains, drawGrid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const erase = event.button === 2 || event.ctrlKey;
      isDrawingRef.current = { active: true, erase };
      applyAtPosition(event.clientX, event.clientY, erase);
    };

    const handlePointerMove = (event) => {
      if (!isDrawingRef.current.active) {
        return;
      }
      applyAtPosition(event.clientX, event.clientY, isDrawingRef.current.erase);
    };

    const handlePointerUp = () => {
      isDrawingRef.current = { active: false, erase: false };
    };

    const preventContextMenu = (event) => {
      event.preventDefault();
    };

    canvas.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    canvas.addEventListener('contextmenu', preventContextMenu);

    return () => {
      canvas.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      canvas.removeEventListener('contextmenu', preventContextMenu);
    };
  }, [applyAtPosition]);

  useEffect(() => {
    if (grainCount > 0 || !isRunning) {
      return;
    }
    setIsRunning(false);
  }, [grainCount, isRunning]);

  return (
    <div className="sand-page">
      <BackButton />
      <div className="sand-game-container">
        <header className="sand-game-header">
          <h1>Sand Blocks</h1>
          <p className="sand-game-subtitle">
            Click or drag to drop sand. Right click or hold Ctrl while drawing to
            erase.
          </p>
        </header>

        <div className="sand-game-hud">
          <div className="sand-game-scoreboard">
            <span>Elapsed: {elapsedTime.toFixed(2)}s</span>
            <span>High Score: {highScore.toFixed(2)}s</span>
            <span>Grains: {grainCount}</span>
            <span>Status: {isRunning ? 'Running' : 'Paused'}</span>
          </div>
          <div className="sand-game-controls">
            <button type="button" onClick={handleStart} className="sand-button">
              Start
            </button>
            <button type="button" onClick={handlePause} className="sand-button">
              Pause
            </button>
            <button type="button" onClick={handleReset} className="sand-button">
              Reset
            </button>
          </div>
        </div>

        <div className="sand-game-board">
          <canvas
            ref={canvasRef}
            className="sand-game-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
          {!isRunning && (
            <div className="sand-game-overlay">
              <div className="sand-game-overlay-content">
                <h2 className="sand-game-overlay-title">Sand Blocks</h2>
                <p className="sand-game-overlay-text">
                  Drop sand with left click to start the simulation.
                </p>
                <button
                  type="button"
                  className="sand-button"
                  onClick={handleStart}
                >
                  Start Simulation
                </button>
                <p className="sand-game-overlay-hint">
                  Right click or hold Ctrl to erase grains.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
