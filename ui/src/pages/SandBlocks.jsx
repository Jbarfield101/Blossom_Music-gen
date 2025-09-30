import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './SandBlocks.css';

const CELL_SIZE = 6;
const GRID_WIDTH = 120;
const GRID_HEIGHT = 80;
const CANVAS_WIDTH = GRID_WIDTH * CELL_SIZE;
const CANVAS_HEIGHT = GRID_HEIGHT * CELL_SIZE;
const SPAWN_INTERVAL = 2000;
const DROP_INTERVAL = 450;
const SPAWN_WARNING_ROW = 10;
const WALL_INDICATOR_WIDTH = 4;
const POINTS_PER_GRAIN = 10;
const STORAGE_KEY = 'sandBlocksHighScore';
const QUEUE_LENGTH = 3;

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

const getNormalizedRotation = (rotation) => ((rotation % 4) + 4) % 4;

const rotateCell = (shape, rotation, x, y) => {
  const normalized = getNormalizedRotation(rotation);
  switch (normalized) {
    case 1:
      return [shape.height - 1 - y, x];
    case 2:
      return [shape.width - 1 - x, shape.height - 1 - y];
    case 3:
      return [y, shape.width - 1 - x];
    default:
      return [x, y];
  }
};

const getRotationInfo = (shape, rotation) => {
  const rotated = shape.cells.map(([x, y]) => rotateCell(shape, rotation, x, y));
  let minX = Infinity;
  let minY = Infinity;
  rotated.forEach(([x, y]) => {
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
  });

  const offsets = rotated.map(([x, y]) => [x - minX, y - minY]);
  const xs = offsets.map(([x]) => x);
  const ys = offsets.map(([, y]) => y);
  const width = Math.max(...xs) + 1;
  const height = Math.max(...ys) + 1;

  return { offsets, width, height };
};

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
  const lastDropTimeRef = useRef(0);

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
  const [nextShapeQueue, setNextShapeQueue] = useState(() =>
    Array.from({ length: QUEUE_LENGTH }, () => randomShape())
  );
  const nextShapeQueueRef = useRef(nextShapeQueue);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const selectedPreviewIndexRef = useRef(selectedPreviewIndex);
  const [activePiece, setActivePiece] = useState(null);
  const activePieceRef = useRef(activePiece);
  const pointerStateRef = useRef(null);

  const updateActivePiece = useCallback((piece) => {
    activePieceRef.current = piece;
    setActivePiece(piece);
  }, []);

  useEffect(() => {
    nextShapeQueueRef.current = nextShapeQueue;
  }, [nextShapeQueue]);

  useEffect(() => {
    selectedPreviewIndexRef.current = selectedPreviewIndex;
  }, [selectedPreviewIndex]);

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

    const piece = activePieceRef.current;
    if (piece) {
      const { offsets } = getRotationInfo(piece.shape, piece.rotation);
      offsets.forEach(([dx, dy]) => {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) {
          return;
        }

        const paletteEntry = COLOR_PALETTE[piece.shape.color - 1] ?? COLOR_PALETTE[0];
        const cellX = x * CELL_SIZE;
        const cellY = y * CELL_SIZE;

        ctx.fillStyle = paletteEntry.value;
        ctx.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE / 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
        ctx.fillRect(cellX, cellY + CELL_SIZE / 2, CELL_SIZE, CELL_SIZE / 2);
      });
    }
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

  const canPlacePiece = useCallback((piece, offsetX = 0, offsetY = 0, rotationDelta = 0) => {
    if (!piece) {
      return false;
    }

    const grid = gridRef.current;
    const rotation = getNormalizedRotation(piece.rotation + rotationDelta);
    const { offsets } = getRotationInfo(piece.shape, rotation);
    const targetX = piece.x + offsetX;
    const targetY = piece.y + offsetY;

    return offsets.every(([dx, dy]) => {
      const x = targetX + dx;
      const y = targetY + dy;
      if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
        return false;
      }
      return grid[y][x] === 0;
    });
  }, []);

  const lockActivePiece = useCallback(
    (piece, timestamp) => {
      if (!piece) {
        return;
      }

      const appliedTimestamp =
        timestamp ?? (typeof window !== 'undefined' && window.performance
          ? window.performance.now()
          : Date.now());

      const grid = gridRef.current.map((row) => row.slice());
      const { offsets } = getRotationInfo(piece.shape, piece.rotation);
      offsets.forEach(([dx, dy]) => {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
          return;
        }
        grid[y][x] = piece.shape.color;
      });

      gridRef.current = grid;
      updateActivePiece(null);
      lastSpawnTimeRef.current = appliedTimestamp;
      lastDropTimeRef.current = appliedTimestamp;
      pointerStateRef.current = null;
      countGrains();
      drawGrid();
    },
    [countGrains, drawGrid, updateActivePiece]
  );

  const stepSimulation = useCallback(
    (timestamp) => {
      if (!isRunningRef.current || isGameOverRef.current) {
        return;
      }

      const piece = activePieceRef.current;
      if (!piece) {
        return;
      }

      if (timestamp - lastDropTimeRef.current < DROP_INTERVAL) {
        return;
      }

      if (canPlacePiece(piece, 0, 1, 0)) {
        const moved = { ...piece, y: piece.y + 1 };
        updateActivePiece(moved);
      } else {
        lockActivePiece(piece, timestamp);
      }

      lastDropTimeRef.current = timestamp;
    },
    [canPlacePiece, lockActivePiece, updateActivePiece]
  );

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
      const queue = nextShapeQueueRef.current;
      if (!queue || queue.length === 0) {
        return;
      }

      const selectedIndex = Math.min(
        selectedPreviewIndexRef.current,
        queue.length - 1
      );
      const shape = queue[selectedIndex];

      const rotation = 0;
      const { width } = getRotationInfo(shape, rotation);
      const spawnX = Math.floor((GRID_WIDTH - width) / 2);
      const piece = {
        shape,
        x: spawnX,
        y: 0,
        rotation,
      };

      if (!canPlacePiece(piece)) {
        setIsGameOver(true);
        setIsRunning(false);
        return;
      }

      updateActivePiece(piece);
      drawGrid();

      const replenishedQueue = [
        ...queue.slice(0, selectedIndex),
        ...queue.slice(selectedIndex + 1),
        randomShape(),
      ];
      nextShapeQueueRef.current = replenishedQueue;
      setNextShapeQueue(replenishedQueue);
      selectedPreviewIndexRef.current = 0;
      setSelectedPreviewIndex(0);
      lastSpawnTimeRef.current = timestamp;
      lastDropTimeRef.current = timestamp;
    },
    [canPlacePiece, drawGrid, updateActivePiece]
  );

  const maybeSpawnShape = useCallback(
    (timestamp) => {
      if (!isRunningRef.current || isGameOverRef.current) {
        return;
      }

      if (activePieceRef.current) {
        return;
      }

      if (timestamp - lastSpawnTimeRef.current < SPAWN_INTERVAL) {
        return;
      }

      spawnShape(timestamp);
    },
    [spawnShape]
  );

  const attemptMovePiece = useCallback(
    (deltaX) => {
      const piece = activePieceRef.current;
      if (!piece || deltaX === 0) {
        return;
      }

      const direction = deltaX > 0 ? 1 : -1;
      let remaining = Math.abs(deltaX);
      let currentPiece = piece;
      let moved = false;

      while (remaining > 0) {
        if (!canPlacePiece(currentPiece, direction, 0, 0)) {
          break;
        }
        currentPiece = { ...currentPiece, x: currentPiece.x + direction };
        remaining -= 1;
        moved = true;
      }

      if (moved) {
        updateActivePiece(currentPiece);
      }
    },
    [canPlacePiece, updateActivePiece]
  );

  const attemptRotatePiece = useCallback(() => {
    const piece = activePieceRef.current;
    if (!piece) {
      return;
    }

    if (!canPlacePiece(piece, 0, 0, 1)) {
      return;
    }

    const rotation = getNormalizedRotation(piece.rotation + 1);
    updateActivePiece({ ...piece, rotation });
  }, [canPlacePiece, updateActivePiece]);

  const attemptSoftDrop = useCallback(() => {
    const piece = activePieceRef.current;
    if (!piece) {
      return;
    }

    if (canPlacePiece(piece, 0, 1, 0)) {
      const moved = { ...piece, y: piece.y + 1 };
      updateActivePiece(moved);
      const now =
        typeof window !== 'undefined' && window.performance
          ? window.performance.now()
          : Date.now();
      lastDropTimeRef.current = now;
    } else {
      lockActivePiece(piece);
    }
  }, [canPlacePiece, lockActivePiece, updateActivePiece]);

  const handlePointerDown = useCallback((event) => {
    if (!isRunningRef.current || isGameOverRef.current || event.button > 0) {
      return;
    }

    const canvas = canvasRef.current;
    const piece = activePieceRef.current;
    if (!canvas || !piece) {
      return;
    }

    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    pointerStateRef.current = {
      id: event.pointerId,
      startX: x,
      originX: piece.x,
      moved: false,
    };

    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
    }
  }, []);

  const handlePointerMove = useCallback(
    (event) => {
      if (!isRunningRef.current || isGameOverRef.current) {
        return;
      }

      const state = pointerStateRef.current;
      if (!state || state.id !== event.pointerId) {
        return;
      }

      const canvas = canvasRef.current;
      const piece = activePieceRef.current;
      if (!canvas || !piece) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const delta = x - state.startX;
      const deltaCells = Math.round(delta / CELL_SIZE);
      if (deltaCells === 0) {
        return;
      }

      event.preventDefault();
      const desiredX = state.originX + deltaCells;
      const moveDelta = desiredX - piece.x;
      if (moveDelta !== 0) {
        attemptMovePiece(moveDelta);
        if (pointerStateRef.current) {
          pointerStateRef.current.moved = true;
        }
      }
    },
    [attemptMovePiece]
  );

  const clearPointerState = useCallback((event) => {
    const canvas = canvasRef.current;
    const state = pointerStateRef.current;
    if (state && event && state.id !== event.pointerId) {
      return;
    }

    pointerStateRef.current = null;
    if (canvas && event && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore failures.
      }
    }
  }, []);

  const handlePointerUp = useCallback(
    (event) => {
      const state = pointerStateRef.current;
      if (
        state &&
        state.id === event.pointerId &&
        !state.moved &&
        isRunningRef.current &&
        !isGameOverRef.current &&
        event.type === 'pointerup'
      ) {
        const canvas = canvasRef.current;
        const piece = activePieceRef.current;
        if (canvas && piece) {
          const rect = canvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          if (Math.abs(x - state.startX) < CELL_SIZE / 2) {
            attemptRotatePiece();
          }
        }
      }

      clearPointerState(event);
    },
    [attemptRotatePiece, clearPointerState]
  );

  const handlePointerCancel = useCallback(
    (event) => {
      clearPointerState(event);
    },
    [clearPointerState]
  );

  useEffect(() => {
    if (!isRunning || isGameOver) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (!isRunningRef.current || isGameOverRef.current) {
        return;
      }

      let handled = false;
      switch (event.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          attemptMovePiece(-1);
          handled = true;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          attemptMovePiece(1);
          handled = true;
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
        case ' ': // Spacebar
        case 'Spacebar':
          attemptRotatePiece();
          handled = true;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          attemptSoftDrop();
          handled = true;
          break;
        default:
          break;
      }

      if (handled) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [attemptMovePiece, attemptRotatePiece, attemptSoftDrop, isGameOver, isRunning]);

  const updateAnimation = useCallback(
    (timestamp) => {
      if (!isRunningRef.current || isGameOverRef.current) {
        return;
      }

      maybeSpawnShape(timestamp);
      stepSimulation(timestamp);
      clearBridges();
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
  }, [activePiece, drawGrid]);

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
    updateActivePiece(null);
    pointerStateRef.current = null;
    drawGrid();
    countGrains();
    lastSpawnTimeRef.current = 0;
    lastDropTimeRef.current = 0;
  }, [countGrains, drawGrid, updateActivePiece]);

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
    const upcoming = Array.from({ length: QUEUE_LENGTH }, () => randomShape());
    nextShapeQueueRef.current = upcoming;
    setNextShapeQueue(upcoming);
    selectedPreviewIndexRef.current = 0;
    setSelectedPreviewIndex(0);
  }, [resetBoard]);

  const handlePlayAgain = useCallback(() => {
    handleReset();
    setIsRunning(true);
  }, [handleReset]);

  const handleSelectQueuedShape = useCallback((index) => {
    selectedPreviewIndexRef.current = index;
    setSelectedPreviewIndex(index);
  }, []);

  useEffect(() => {
    if (selectedPreviewIndex >= nextShapeQueue.length) {
      selectedPreviewIndexRef.current = 0;
      setSelectedPreviewIndex(0);
    }
  }, [nextShapeQueue, selectedPreviewIndex]);

  const previewCards = useMemo(() => {
    const createMatrix = (shape) => {
      const matrix = Array.from({ length: 4 }, () => Array(4).fill(0));
      if (!shape) {
        return matrix;
      }

      const offsetX = Math.floor((4 - shape.width) / 2);
      const offsetY = Math.floor((4 - shape.height) / 2);

      shape.cells.forEach(([dx, dy]) => {
        const px = dx + offsetX;
        const py = dy + offsetY;
        if (px >= 0 && px < 4 && py >= 0 && py < 4) {
          matrix[py][px] = shape.color;
        }
      });

      return matrix;
    };

    return nextShapeQueue.map((shape) => ({
      shape,
      matrix: createMatrix(shape),
    }));
  }, [nextShapeQueue]);

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
            <span className="sand-preview-title">Upcoming Queue</span>
            <div className="sand-preview-queue">
              {previewCards.map(({ shape, matrix }, index) => {
                const paletteEntry = COLOR_PALETTE[shape?.color - 1];
                const isSelected = index === selectedPreviewIndex;
                const label = shape
                  ? `${paletteEntry?.name ?? 'Unknown'} ${shape.name}`
                  : 'Empty';

                return (
                  <button
                    key={shape?.name ? `${shape.name}-${index}` : index}
                    type="button"
                    onClick={() => handleSelectQueuedShape(index)}
                    className={`sand-preview-card${
                      isSelected ? ' selected' : ''
                    }`}
                    aria-pressed={isSelected}
                    aria-label={`Select queued shape ${index + 1}: ${label}`}
                  >
                    <span className="sand-preview-order">#{index + 1}</span>
                    <div className="sand-preview-grid">
                      {matrix.map((row, rowIndex) =>
                        row.map((value, columnIndex) => {
                          const key = `${index}-${rowIndex}-${columnIndex}`;
                          const cellPalette = COLOR_PALETTE[value - 1];
                          const style = value
                            ? { backgroundColor: cellPalette?.value }
                            : undefined;
                          const cellClass = value
                            ? 'sand-preview-cell'
                            : 'sand-preview-cell empty';
                          return (
                            <div key={key} className={cellClass} style={style} />
                          );
                        })
                      )}
                    </div>
                    <span className="sand-preview-label">{label}</span>
                  </button>
                );
              })}
            </div>
            <span className="sand-preview-helper">
              Tap a card to choose which block will drop next.
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
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerUp}
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
