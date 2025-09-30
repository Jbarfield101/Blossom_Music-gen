import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './SandBlocks.css';

const CELL_SIZE = 6;
const GRID_WIDTH = 120;
const GRID_HEIGHT = 80;
const CANVAS_WIDTH = GRID_WIDTH * CELL_SIZE;
const CANVAS_HEIGHT = GRID_HEIGHT * CELL_SIZE;
const SPAWN_INTERVAL = 2000;
const SPAWN_WARNING_ROW = 10;
const WALL_INDICATOR_WIDTH = 4;
const POINTS_PER_GRAIN = 10;
const STORAGE_KEY = 'sandBlocksHighScore';

const COLOR_PALETTE = [
  { name: 'Sunburst', value: '#fbbf24' },
  { name: 'Lagoon', value: '#38bdf8' },
  { name: 'Rose Quartz', value: '#fb7185' },
  { name: 'Verdant', value: '#34d399' },
  { name: 'Amethyst', value: '#a78bfa' },
  { name: 'Tangerine', value: '#fb923c' },
];

const BASE_SHAPES = [
  {
    name: 'Square',
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    name: 'Line',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
  },
  {
    name: 'Tee',
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ],
  },
  {
    name: 'L-Shape',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
    ],
  },
  {
    name: 'J-Shape',
    cells: [
      [1, 0],
      [1, 1],
      [1, 2],
      [0, 2],
    ],
  },
  {
    name: 'Zig',
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  {
    name: 'Zag',
    cells: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  },
];

const SHAPES = BASE_SHAPES.map((shape) => {
  const xs = shape.cells.map(([x]) => x);
  const ys = shape.cells.map(([, y]) => y);
  return {
    ...shape,
    width: Math.max(...xs) + 1,
    height: Math.max(...ys) + 1,
  };
});

const createEmptyGrid = () =>
  Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill(0));

const randomShape = () => {
  const template = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const color = Math.floor(Math.random() * COLOR_PALETTE.length) + 1;
  return { ...template, color };
};

export default function SandBlocks() {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const gridRef = useRef(createEmptyGrid());
  const isRunningRef = useRef(false);
  const isGameOverRef = useRef(false);
  const lastSpawnTimeRef = useRef(0);

  const [isRunning, setIsRunning] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [grainCount, setGrainCount] = useState(0);
  const [score, setScore] = useState(0);
  const [bridgesCleared, setBridgesCleared] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === 'undefined') {
      return 0;
    }

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const parsed = Number.parseInt(stored ?? '0', 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  });
  const [nextShape, setNextShape] = useState(() => randomShape());
  const nextShapeRef = useRef(nextShape);

  useEffect(() => {
    nextShapeRef.current = nextShape;
  }, [nextShape]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    isGameOverRef.current = isGameOver;
  }, [isGameOver]);

  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.fillRect(0, 0, WALL_INDICATOR_WIDTH * CELL_SIZE, CANVAS_HEIGHT);
    ctx.fillRect(
      CANVAS_WIDTH - WALL_INDICATOR_WIDTH * CELL_SIZE,
      0,
      WALL_INDICATOR_WIDTH * CELL_SIZE,
      CANVAS_HEIGHT
    );

    const grid = gridRef.current;
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const value = grid[y][x];
        if (value === 0) {
          continue;
        }

        const paletteEntry = COLOR_PALETTE[value - 1] ?? COLOR_PALETTE[0];
        const cellX = x * CELL_SIZE;
        const cellY = y * CELL_SIZE;

        ctx.fillStyle = paletteEntry.value;
        ctx.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE / 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
        ctx.fillRect(cellX, cellY + CELL_SIZE / 2, CELL_SIZE, CELL_SIZE / 2);
      }
    }

    const warningY = SPAWN_WARNING_ROW * CELL_SIZE + CELL_SIZE / 2;
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([CELL_SIZE * 2, CELL_SIZE]);
    ctx.beginPath();
    ctx.moveTo(0, warningY);
    ctx.lineTo(CANVAS_WIDTH, warningY);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  const countGrains = useCallback(() => {
    const grid = gridRef.current;
    let count = 0;
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        if (grid[y][x] !== 0) {
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
        const cell = currentGrid[y][x];
        if (cell === 0) {
          continue;
        }

        const belowY = y + 1;
        if (currentGrid[belowY][x] === 0) {
          nextGrid[belowY][x] = cell;
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
        nextGrid[belowY][choice] = cell;
        nextGrid[y][x] = 0;
        moved = true;
      }
    }

    if (moved) {
      gridRef.current = nextGrid;
    }

    return moved;
  }, []);

  const clearBridges = useCallback(() => {
    const grid = gridRef.current;
    const visited = Array.from({ length: GRID_HEIGHT }, () =>
      Array(GRID_WIDTH).fill(false)
    );

    let clearedCells = 0;
    let componentsCleared = 0;

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      const color = grid[y][0];
      if (color === 0 || visited[y][0]) {
        continue;
      }

      const queue = [[0, y]];
      const component = [];
      let touchesRight = false;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        if (
          cx < 0 ||
          cy < 0 ||
          cx >= GRID_WIDTH ||
          cy >= GRID_HEIGHT ||
          visited[cy][cx]
        ) {
          continue;
        }

        if (grid[cy][cx] !== color) {
          continue;
        }

        visited[cy][cx] = true;
        component.push([cx, cy]);

        if (cx === GRID_WIDTH - 1) {
          touchesRight = true;
        }

        for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
          for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
            if (nx === cx && ny === cy) {
              continue;
            }
            if (nx < 0 || ny < 0 || nx >= GRID_WIDTH || ny >= GRID_HEIGHT) {
              continue;
            }
            if (!visited[ny][nx] && grid[ny][nx] === color) {
              queue.push([nx, ny]);
            }
          }
        }
      }

      if (touchesRight && component.length > 0) {
        component.forEach(([cx, cy]) => {
          grid[cy][cx] = 0;
        });
        clearedCells += component.length;
        componentsCleared += 1;
      }
    }

    if (clearedCells > 0) {
      gridRef.current = grid;
      setBridgesCleared((prev) => prev + componentsCleared);
      setScore((prevScore) => {
        const updatedScore = prevScore + clearedCells * POINTS_PER_GRAIN;
        setHighScore((prevHigh) =>
          updatedScore > prevHigh ? updatedScore : prevHigh
        );
        return updatedScore;
      });
      drawGrid();
      countGrains();
    }
  }, [countGrains, drawGrid]);

  const spawnShape = useCallback(
    (timestamp) => {
      const shape = nextShapeRef.current;
      if (!shape) {
        return;
      }

      const spawnX = Math.floor((GRID_WIDTH - shape.width) / 2);
      const placements = shape.cells.map(([dx, dy]) => ({
        x: spawnX + dx,
        y: dy,
      }));

      const grid = gridRef.current;
      const blocked = placements.some(
        ({ x, y }) => x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT || grid[y][x] !== 0
      );

      if (blocked) {
        setIsGameOver(true);
        setIsRunning(false);
        return;
      }

      placements.forEach(({ x, y }) => {
        grid[y][x] = shape.color;
      });
      gridRef.current = grid;
      countGrains();
      drawGrid();

      const upcoming = randomShape();
      nextShapeRef.current = upcoming;
      setNextShape(upcoming);
      lastSpawnTimeRef.current = timestamp;
    },
    [countGrains, drawGrid]
  );

  const maybeSpawnShape = useCallback(
    (timestamp) => {
      if (!isRunningRef.current || isGameOverRef.current) {
        return;
      }

      if (timestamp - lastSpawnTimeRef.current < SPAWN_INTERVAL) {
        return;
      }

      spawnShape(timestamp);
    },
    [spawnShape]
  );

  const updateAnimation = useCallback(
    (timestamp) => {
      if (!isRunningRef.current || isGameOverRef.current) {
        return;
      }

      stepSimulation();
      clearBridges();
      maybeSpawnShape(timestamp);
      drawGrid();

      animationFrameRef.current = window.requestAnimationFrame(updateAnimation);
    },
    [clearBridges, drawGrid, maybeSpawnShape, stepSimulation]
  );

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
    lastSpawnTimeRef.current = 0;
  }, [countGrains, drawGrid]);

  const handleStart = useCallback(() => {
    if (isGameOver) {
      return;
    }
    setIsRunning(true);
  }, [isGameOver]);

  const handlePause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    setIsGameOver(false);
    resetBoard();
    setScore(0);
    setBridgesCleared(0);
    const upcoming = randomShape();
    nextShapeRef.current = upcoming;
    setNextShape(upcoming);
  }, [resetBoard]);

  const handlePlayAgain = useCallback(() => {
    handleReset();
    setIsRunning(true);
  }, [handleReset]);

  const previewMatrix = useMemo(() => {
    const matrix = Array.from({ length: 4 }, () => Array(4).fill(0));
    if (!nextShape) {
      return matrix;
    }

    const offsetX = Math.floor((4 - nextShape.width) / 2);
    const offsetY = Math.floor((4 - nextShape.height) / 2);

    nextShape.cells.forEach(([dx, dy]) => {
      const px = dx + offsetX;
      const py = dy + offsetY;
      if (px >= 0 && px < 4 && py >= 0 && py < 4) {
        matrix[py][px] = nextShape.color;
      }
    });

    return matrix;
  }, [nextShape]);

  const statusLabel = isGameOver
    ? 'Game Over'
    : isRunning
    ? 'Running'
    : 'Paused';

  const statusBadgeClass = isGameOver
    ? 'sand-score-badge over'
    : isRunning
    ? 'sand-score-badge running'
    : 'sand-score-badge paused';

  const nextColor = COLOR_PALETTE[nextShape?.color - 1];

  return (
    <div className="sand-page">
      <BackButton />
      <div className="sand-game-container">
        <header className="sand-game-header">
          <h1>Sand Blocks</h1>
          <p className="sand-game-subtitle">
            Guide falling blocky sand shapes and forge bridges of matching colors
            from the left wall to the right wall to clear them and score points.
          </p>
        </header>

        <div className="sand-game-hud">
          <div className="sand-game-scoreboard">
            <div className="sand-score-card">
              <span className="sand-score-label">Score</span>
              <span className="sand-score-value">{score.toLocaleString()}</span>
            </div>
            <div className="sand-score-card">
              <span className="sand-score-label">High Score</span>
              <span className="sand-score-value">
                {highScore.toLocaleString()}
              </span>
            </div>
            <div className="sand-score-card">
              <span className="sand-score-label">Bridges Cleared</span>
              <span className="sand-score-value">
                {bridgesCleared.toLocaleString()}
              </span>
            </div>
            <div className="sand-score-card">
              <span className="sand-score-label">Grains</span>
              <span className="sand-score-value">{grainCount.toLocaleString()}</span>
            </div>
            <div className="sand-score-card">
              <span className="sand-score-label">Status</span>
              <span className={statusBadgeClass}>{statusLabel}</span>
            </div>
          </div>

          <div className="sand-game-preview">
            <span className="sand-preview-title">Next</span>
            <div className="sand-preview-grid">
              {previewMatrix.map((row, rowIndex) =>
                row.map((value, columnIndex) => {
                  const key = `${rowIndex}-${columnIndex}`;
                  const paletteEntry = COLOR_PALETTE[value - 1];
                  const style = value
                    ? { backgroundColor: paletteEntry?.value }
                    : undefined;
                  const cellClass = value
                    ? 'sand-preview-cell'
                    : 'sand-preview-cell empty';
                  return <div key={key} className={cellClass} style={style} />;
                })
              )}
            </div>
            <span className="sand-preview-label">
              {nextColor ? `${nextColor.name} ${nextShape.name}` : nextShape.name}
            </span>
          </div>
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

        <div className="sand-game-board">
          <canvas
            ref={canvasRef}
            className="sand-game-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
          {(!isRunning || isGameOver) && (
            <div className="sand-game-overlay">
              <div className="sand-game-overlay-content">
                <h2 className="sand-game-overlay-title">Sand Blocks</h2>
                <p className="sand-game-overlay-text">
                  Connect a single color from one wall to the other using the
                  falling tetromino-style sand pieces. Clearing bridges keeps the
                  board from overflowing and earns huge points.
                </p>
                {isGameOver ? (
                  <button
                    type="button"
                    className="sand-button"
                    onClick={handlePlayAgain}
                  >
                    Play Again
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sand-button"
                    onClick={handleStart}
                  >
                    Start Simulation
                  </button>
                )}
                <p className="sand-game-overlay-hint">
                  Tip: Watch the edges—only bridges that touch both walls will
                  collapse into points.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
