import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './SandBlocks.css';

const CELL_SIZE = 32;
const GRID_WIDTH = 36;
const GRID_HEIGHT = 24;
const CANVAS_WIDTH = GRID_WIDTH * CELL_SIZE;
const CANVAS_HEIGHT = GRID_HEIGHT * CELL_SIZE;
const SPAWN_WARNING_ROW = 6;
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

export default function SandBlocks() {
  const canvasRef = useRef(null);
  const gridRef = useRef(createEmptyGrid());
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
  const [selectedShapeIndex, setSelectedShapeIndex] = useState(0);
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [activePiece, setActivePiece] = useState(null);
  const activePieceRef = useRef(activePiece);
  const pointerStateRef = useRef(null);
  const previousShapeIndexRef = useRef(selectedShapeIndex);

  const updateActivePiece = useCallback((piece) => {
    activePieceRef.current = piece;
    setActivePiece(piece);
  }, []);

  const canPlacePiece = useCallback(
    (piece, offsetX = 0, offsetY = 0, rotationDelta = 0) => {
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
    },
    []
  );

  useEffect(() => {
    const piece = activePieceRef.current;
    if (!piece) {
      return;
    }

    const paletteEntry = COLOR_PALETTE[selectedColorIndex];
    if (!paletteEntry) {
      return;
    }

    const colorId = selectedColorIndex + 1;
    if (piece.shape.color === colorId) {
      return;
    }

    updateActivePiece({
      ...piece,
      shape: { ...piece.shape, color: colorId },
    });
  }, [selectedColorIndex, updateActivePiece]);

  useEffect(() => {
    const previousShapeIndex = previousShapeIndexRef.current;
    if (previousShapeIndex === selectedShapeIndex && activePieceRef.current) {
      return;
    }

    previousShapeIndexRef.current = selectedShapeIndex;

    const template = SHAPES[selectedShapeIndex];
    const paletteEntry = COLOR_PALETTE[selectedColorIndex];
    if (!template || !paletteEntry) {
      updateActivePiece(null);
      return;
    }

    const colorId = selectedColorIndex + 1;
    const rotation = 0;
    const startX = Math.max(0, Math.floor((GRID_WIDTH - template.width) / 2));
    const startY = Math.max(0, Math.floor((GRID_HEIGHT - template.height) / 2));
    let candidate = {
      shape: { ...template, color: colorId },
      x: startX,
      y: startY,
      rotation,
    };

    if (!canPlacePiece(candidate)) {
      let placed = false;
      for (let ty = 0; ty <= GRID_HEIGHT - template.height; ty += 1) {
        for (let tx = 0; tx <= GRID_WIDTH - template.width; tx += 1) {
          const attempt = {
            shape: { ...template, color: colorId },
            x: tx,
            y: ty,
            rotation,
          };
          if (canPlacePiece(attempt)) {
            candidate = attempt;
            placed = true;
            break;
          }
        }
        if (placed) {
          break;
        }
      }

      if (!placed) {
        updateActivePiece(null);
        return;
      }
    }

    updateActivePiece(candidate);
  }, [canPlacePiece, selectedColorIndex, selectedShapeIndex, updateActivePiece]);

  useEffect(() => {
    if (activePiece) {
      return;
    }

    const template = SHAPES[selectedShapeIndex];
    const paletteEntry = COLOR_PALETTE[selectedColorIndex];
    if (!template || !paletteEntry) {
      return;
    }

    const colorId = selectedColorIndex + 1;
    const rotation = 0;
    const startX = Math.max(0, Math.floor((GRID_WIDTH - template.width) / 2));
    const startY = Math.max(0, Math.floor((GRID_HEIGHT - template.height) / 2));
    let candidate = {
      shape: { ...template, color: colorId },
      x: startX,
      y: startY,
      rotation,
    };

    if (!canPlacePiece(candidate)) {
      let placed = false;
      for (let ty = 0; ty <= GRID_HEIGHT - template.height; ty += 1) {
        for (let tx = 0; tx <= GRID_WIDTH - template.width; tx += 1) {
          const attempt = {
            shape: { ...template, color: colorId },
            x: tx,
            y: ty,
            rotation,
          };
          if (canPlacePiece(attempt)) {
            candidate = attempt;
            placed = true;
            break;
          }
        }
        if (placed) {
          break;
        }
      }

      if (!placed) {
        return;
      }
    }

    updateActivePiece(candidate);
  }, [activePiece, canPlacePiece, selectedColorIndex, selectedShapeIndex, updateActivePiece]);

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

  const lockActivePiece = useCallback(
    (piece) => {
      if (!piece || !canPlacePiece(piece)) {
        return false;
      }

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
      pointerStateRef.current = null;
      countGrains();
      drawGrid();
      return true;
    },
    [canPlacePiece, countGrains, drawGrid, updateActivePiece]
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

  const handlePlacePiece = useCallback(() => {
    const piece = activePieceRef.current;
    if (!piece) {
      return;
    }

    if (lockActivePiece(piece)) {
      clearBridges();
    }
  }, [clearBridges, lockActivePiece]);

  const attemptMovePiece = useCallback(
    (deltaX = 0, deltaY = 0) => {
      const piece = activePieceRef.current;
      if (!piece || (deltaX === 0 && deltaY === 0)) {
        return;
      }

      let currentPiece = piece;
      let moved = false;

      const stepAxis = (axisDelta, axis) => {
        const direction = axisDelta > 0 ? 1 : -1;
        let remaining = Math.abs(axisDelta);
        while (remaining > 0) {
          const offsetX = axis === 'x' ? direction : 0;
          const offsetY = axis === 'y' ? direction : 0;
          if (!canPlacePiece(currentPiece, offsetX, offsetY, 0)) {
            break;
          }
          currentPiece = {
            ...currentPiece,
            x: currentPiece.x + offsetX,
            y: currentPiece.y + offsetY,
          };
          remaining -= 1;
          moved = true;
        }
      };

      if (deltaX !== 0) {
        stepAxis(deltaX, 'x');
      }
      if (deltaY !== 0) {
        stepAxis(deltaY, 'y');
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
    attemptMovePiece(0, 1);
  }, [attemptMovePiece]);

  const handlePointerDown = useCallback((event) => {
    if (event.button > 0) {
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
    const y = event.clientY - rect.top;
    pointerStateRef.current = {
      id: event.pointerId,
      startX: x,
      startY: y,
      originX: piece.x,
      originY: piece.y,
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
      const y = event.clientY - rect.top;
      const deltaX = Math.round((x - state.startX) / CELL_SIZE);
      const deltaY = Math.round((y - state.startY) / CELL_SIZE);
      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      event.preventDefault();
      const desiredX = state.originX + deltaX;
      const desiredY = state.originY + deltaY;
      const moveDeltaX = desiredX - piece.x;
      const moveDeltaY = desiredY - piece.y;
      if (moveDeltaX !== 0 || moveDeltaY !== 0) {
        attemptMovePiece(moveDeltaX, moveDeltaY);
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
    const handleKeyDown = (event) => {
      let handled = false;
      switch (event.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          attemptMovePiece(-1, 0);
          handled = true;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          attemptMovePiece(1, 0);
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
        case 'Enter':
          handlePlacePiece();
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
  }, [attemptMovePiece, attemptRotatePiece, attemptSoftDrop, handlePlacePiece]);

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
  }, [countGrains, drawGrid, updateActivePiece]);

  const handleReset = useCallback(() => {
    resetBoard();
    setScore(0);
    setBridgesCleared(0);
  }, [resetBoard]);

  const selectedColor = COLOR_PALETTE[selectedColorIndex];

  const paletteShapes = useMemo(() => {
    const createMatrix = (shape) => {
      const size = 4;
      const matrix = Array.from({ length: size }, () => Array(size).fill(0));
      const offsetX = Math.floor((size - shape.width) / 2);
      const offsetY = Math.floor((size - shape.height) / 2);

      shape.cells.forEach(([dx, dy]) => {
        const px = dx + offsetX;
        const py = dy + offsetY;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          matrix[py][px] = 1;
        }
      });

      return matrix;
    };

    return SHAPES.map((shape, index) => ({
      shape,
      index,
      matrix: createMatrix(shape),
    }));
  }, []);

  return (
    <div className="sand-page">
      <BackButton />
      <div className="sand-game-container">
        <header className="sand-game-header">
          <h1>Sand Blocks</h1>
          <p className="sand-game-subtitle">
            Craft colorful bridges by placing sand blocks anywhere in the play
            field. Connect matching colors from the left wall to the right wall
            to clear bridges and rack up points.
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
          </div>

          <div className="sand-game-palette">
            <span className="sand-palette-title">Block Palette</span>
            <div className="sand-palette-colors" role="radiogroup" aria-label="Select block color">
              {COLOR_PALETTE.map((paletteEntry, index) => {
                const isSelected = index === selectedColorIndex;
                return (
                  <button
                    key={paletteEntry.name}
                    type="button"
                    className={`sand-color-swatch${isSelected ? ' selected' : ''}`}
                    style={{ backgroundColor: paletteEntry.value }}
                    onClick={() => setSelectedColorIndex(index)}
                    aria-pressed={isSelected}
                    aria-label={`Use ${paletteEntry.name} blocks`}
                  />
                );
              })}
            </div>
            <div className="sand-palette-grid">
              {paletteShapes.map(({ shape, index, matrix }) => {
                const isSelected = index === selectedShapeIndex;
                return (
                  <button
                    key={shape.name}
                    type="button"
                    onClick={() => setSelectedShapeIndex(index)}
                    className={`sand-palette-card${isSelected ? ' selected' : ''}`}
                    aria-pressed={isSelected}
                    aria-label={`Select ${shape.name} block`}
                  >
                    <span className="sand-palette-shape-name">{shape.name}</span>
                    <div className="sand-preview-grid small">
                      {matrix.map((row, rowIndex) =>
                        row.map((value, columnIndex) => {
                          const key = `${shape.name}-${rowIndex}-${columnIndex}`;
                          const style = value
                            ? { backgroundColor: selectedColor?.value }
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
                  </button>
                );
              })}
            </div>
            <p className="sand-palette-helper">
              Choose a color and shape, then drag the block around the board. Double
              click or press Enter to place it.
            </p>
          </div>
        </div>

        <div className="sand-game-controls">
          <button type="button" onClick={handlePlacePiece} className="sand-button">
            Place Block
          </button>
          <button type="button" onClick={attemptRotatePiece} className="sand-button">
            Rotate
          </button>
          <button type="button" onClick={() => attemptMovePiece(0, -1)} className="sand-button">
            Nudge Up
          </button>
          <button type="button" onClick={handleReset} className="sand-button">
            Clear Board
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
            onDoubleClick={handlePlacePiece}
          />
        </div>
      </div>
    </div>
  );
}
