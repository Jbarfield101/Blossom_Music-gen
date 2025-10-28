import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import BackButton from '../components/BackButton.jsx';
import './Whiteboard.css';

const STORAGE_KEY = 'blossom.whiteboard.boards';
const DEFAULT_BACKGROUND = '#0f172a';

const DEFAULT_APP_STATE = {
  viewBackgroundColor: DEFAULT_BACKGROUND,
  theme: 'dark',
  gridSize: 0,
  gridMode: 'grid',
  zenModeEnabled: false,
  viewModeEnabled: false,
};

const BACKGROUNDS = [
  { id: 'slate', color: '#0f172a', label: 'Midnight' },
  { id: 'indigo', color: '#312e81', label: 'Indigo' },
  { id: 'emerald', color: '#064e3b', label: 'Emerald' },
  { id: 'sand', color: '#fef3c7', label: 'Parchment' },
];

const THEMES = [
  { id: 'dark', label: 'Dark', theme: 'dark' },
  { id: 'light', label: 'Light', theme: 'light' },
  { id: 'paper', label: 'Paper', theme: 'light', background: '#f5f1e6' },
];

const GRID_OPTIONS = [
  { id: 'off', label: 'Off', gridSize: 0 },
  { id: 'grid', label: 'Grid', gridSize: 20 },
  { id: 'dots', label: 'Dots', gridSize: 20, gridMode: 'dots' },
];

const PRESET_TOKENS = [
  { id: 'hero', label: 'Hero Token', text: 'Hero', color: '#38bdf8', fill: 'rgba(56, 189, 248, 0.2)' },
  { id: 'villain', label: 'Boss Token', text: 'Boss', color: '#f87171', fill: 'rgba(248, 113, 113, 0.2)' },
  { id: 'npc', label: 'NPC Token', text: 'NPC', color: '#fbbf24', fill: 'rgba(251, 191, 36, 0.2)' },
];

const PRESET_ROOMS = [
  {
    id: 'tavern',
    label: 'Tavern Room',
    width: 480,
    height: 360,
    strokeColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.18)',
  },
  {
    id: 'dungeon',
    label: 'Dungeon Chamber',
    width: 520,
    height: 420,
    strokeColor: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
  },
  {
    id: 'camp',
    label: 'Camp Site',
    width: 420,
    height: 320,
    strokeColor: '#4ade80',
    backgroundColor: 'rgba(74, 222, 128, 0.18)',
  },
];

function generateId(prefix = 'whiteboard') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.round(Math.random() * 10_000)}`;
}

function loadBoards() {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.map((board) => ({
        id: board.id ?? generateId('board'),
        name: board.name ?? 'Untitled Board',
        elements: Array.isArray(board.elements) ? board.elements : [],
        appState: sanitizeAppState(board.appState ?? {}),
        files: board.files ?? {},
        updatedAt: board.updatedAt ?? Date.now(),
      }));
    }
  } catch (error) {
    console.warn('Failed to load whiteboards from storage', error);
  }
  return [];
}

function persistBoards(boards) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
  } catch (error) {
    console.warn('Failed to persist whiteboards', error);
  }
}

function sanitizeAppState(appState = {}) {
  const { collaborators, pendingImageElement, ...rest } = appState;
  return JSON.parse(
    JSON.stringify({
      ...DEFAULT_APP_STATE,
      ...rest,
    }),
  );
}

function filesMapToObject(files) {
  if (!files) {
    return {};
  }
  return Object.fromEntries(
    Array.from(files.entries()).map(([fileId, data]) => [fileId, { ...data }]),
  );
}

function filesObjectToMap(filesObject = {}) {
  return new Map(
    Object.entries(filesObject).map(([fileId, data]) => [fileId, { ...data }]),
  );
}

function createBaseShape({ type, x, y, width, height, strokeColor, backgroundColor }) {
  return {
    type,
    id: generateId('element'),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1_000_000),
    isDeleted: false,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    seed: Math.floor(Math.random() * 1_000_000),
    groupIds: [],
    roundness: type === 'rectangle' ? { type: 3 } : null,
    boundElementIds: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: {},
    frameId: null,
  };
}

function createTextElement({ text, x, y, color }) {
  const width = Math.max(140, text.length * 18);
  const height = 48;
  return {
    type: 'text',
    id: generateId('text'),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1_000_000),
    isDeleted: false,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: color,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    seed: Math.floor(Math.random() * 1_000_000),
    groupIds: [],
    roundness: null,
    boundElementIds: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: {},
    frameId: null,
    text,
    originalText: text,
    fontSize: 32,
    fontFamily: 1,
    textAlign: 'center',
    verticalAlign: 'middle',
    baseline: 32,
    lineHeight: 1.25,
    containerId: null,
  };
}

function createTokenElements(preset, origin) {
  const { x, y } = origin;
  const base = createBaseShape({
    type: 'ellipse',
    x: x - 80,
    y: y - 80,
    width: 160,
    height: 160,
    strokeColor: preset.color,
    backgroundColor: preset.fill,
  });
  const label = createTextElement({ text: preset.text, x: x - 60, y: y - 20, color: preset.color });
  return [base, label];
}

function createRoomElements(room, origin) {
  const { x, y } = origin;
  const rect = createBaseShape({
    type: 'rectangle',
    x: x - room.width / 2,
    y: y - room.height / 2,
    width: room.width,
    height: room.height,
    strokeColor: room.strokeColor,
    backgroundColor: room.backgroundColor,
  });
  return [rect];
}

function createEmptyBoard(name) {
  return {
    id: generateId('board'),
    name,
    elements: [],
    appState: { ...DEFAULT_APP_STATE },
    files: {},
    updatedAt: Date.now(),
  };
}

function getViewportCenter(appState) {
  const { scrollX = 0, scrollY = 0, zoom = 1, width = window.innerWidth, height = window.innerHeight } = appState;
  const centerX = -scrollX + width / 2 / zoom;
  const centerY = -scrollY + height / 2 / zoom;
  return { x: centerX, y: centerY };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function WhiteboardPage() {
  const excalidrawRef = useRef(null);
  const fileInputRef = useRef(null);
  const [boards, setBoards] = useState(() => {
    const stored = loadBoards();
    if (stored.length) {
      return stored;
    }
    const initial = createEmptyBoard('Campaign Whiteboard');
    persistBoards([initial]);
    return [initial];
  });
  const [activeBoardId, setActiveBoardId] = useState(() => {
    const stored = loadBoards();
    if (stored.length) {
      return stored[0].id;
    }
    const initial = createEmptyBoard('Campaign Whiteboard');
    persistBoards([initial]);
    return initial.id;
  });
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!activeBoardId && boards.length) {
      setActiveBoardId(boards[0].id);
    }
  }, [boards, activeBoardId]);

  useEffect(() => {
    persistBoards(boards);
  }, [boards]);

  const activeBoard = useMemo(() => boards.find((board) => board.id === activeBoardId) ?? null, [boards, activeBoardId]);

  const applyScene = useCallback(
    (board) => {
      if (!board || !excalidrawRef.current) {
        return;
      }
      const api = excalidrawRef.current;
      api.updateScene({
        elements: board.elements,
        appState: sanitizeAppState(board.appState),
        files: filesObjectToMap(board.files),
      });
      setIsDirty(false);
    },
    [],
  );

  useEffect(() => {
    if (activeBoard) {
      applyScene(activeBoard);
    }
  }, [activeBoard, applyScene]);

  const handleChange = useCallback(() => {
    setIsDirty(true);
  }, []);

  const handleCreateBoard = useCallback(() => {
    const name = window.prompt('Board name', 'New Whiteboard');
    if (!name) {
      return;
    }
    const board = createEmptyBoard(name.trim());
    setBoards((prev) => [...prev, board]);
    setActiveBoardId(board.id);
  }, []);

  const handleRenameBoard = useCallback(() => {
    if (!activeBoard) {
      return;
    }
    const name = window.prompt('Rename board', activeBoard.name);
    if (!name) {
      return;
    }
    setBoards((prev) =>
      prev.map((board) => (board.id === activeBoard.id ? { ...board, name: name.trim(), updatedAt: Date.now() } : board)),
    );
  }, [activeBoard]);

  const handleDeleteBoard = useCallback(
    (boardId) => {
      const board = boards.find((item) => item.id === boardId);
      if (!board) {
        return;
      }
      if (!window.confirm(`Delete "${board.name}"? This cannot be undone.`)) {
        return;
      }
      setBoards((prev) => {
        const next = prev.filter((item) => item.id !== boardId);
        if (boardId === activeBoardId) {
          setActiveBoardId(next[0]?.id ?? null);
        }
        return next;
      });
    },
    [boards, activeBoardId],
  );

  const requestSwitchBoard = useCallback(
    (boardId) => {
      if (boardId === activeBoardId) {
        return;
      }
      if (isDirty && !window.confirm('You have unsaved changes. Switch boards anyway?')) {
        return;
      }
      setActiveBoardId(boardId);
    },
    [activeBoardId, isDirty],
  );

  const handleSaveBoard = useCallback(() => {
    if (!activeBoard || !excalidrawRef.current) {
      return;
    }
    const api = excalidrawRef.current;
    const elements = api.getSceneElements();
    const appState = sanitizeAppState(api.getAppState());
    const files = filesMapToObject(api.getFiles());
    const updated = {
      ...activeBoard,
      elements,
      appState,
      files,
      updatedAt: Date.now(),
    };
    setBoards((prev) => prev.map((board) => (board.id === updated.id ? updated : board)));
    setIsDirty(false);
  }, [activeBoard]);

  const handleLoadBoard = useCallback(() => {
    if (activeBoard) {
      applyScene(activeBoard);
    }
  }, [activeBoard, applyScene]);

  const handleBackgroundChange = useCallback((color) => {
    if (!excalidrawRef.current) {
      return;
    }
    const api = excalidrawRef.current;
    const nextState = {
      ...sanitizeAppState(api.getAppState()),
      viewBackgroundColor: color,
    };
    api.updateScene({ appState: nextState });
    setIsDirty(true);
  }, []);

  const handleThemeChange = useCallback((option) => {
    if (!excalidrawRef.current) {
      return;
    }
    const api = excalidrawRef.current;
    const baseState = sanitizeAppState(api.getAppState());
    const nextState = {
      ...baseState,
      theme: option.theme,
      viewBackgroundColor: option.background ?? baseState.viewBackgroundColor,
    };
    api.updateScene({ appState: nextState });
    setIsDirty(true);
  }, []);

  const handleGridChange = useCallback((option) => {
    if (!excalidrawRef.current) {
      return;
    }
    const api = excalidrawRef.current;
    const baseState = sanitizeAppState(api.getAppState());
    const nextState = {
      ...baseState,
      gridSize: option.gridSize,
      gridMode: option.gridMode ?? 'grid',
    };
    api.updateScene({ appState: nextState });
    setIsDirty(true);
  }, []);

  const insertElements = useCallback((elements) => {
    if (!excalidrawRef.current || !elements.length) {
      return;
    }
    const api = excalidrawRef.current;
    const currentElements = api.getSceneElements();
    api.updateScene({ elements: [...currentElements, ...elements] });
    setIsDirty(true);
  }, []);

  const handleAddToken = useCallback(
    (preset) => {
      if (!excalidrawRef.current) {
        return;
      }
      const api = excalidrawRef.current;
      const origin = getViewportCenter(api.getAppState());
      insertElements(createTokenElements(preset, origin));
    },
    [insertElements],
  );

  const handleAddRoom = useCallback(
    (room) => {
      if (!excalidrawRef.current) {
        return;
      }
      const api = excalidrawRef.current;
      const origin = getViewportCenter(api.getAppState());
      insertElements(createRoomElements(room, origin));
    },
    [insertElements],
  );

  const handleImageUpload = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file || !excalidrawRef.current) {
        return;
      }
      const api = excalidrawRef.current;
      const origin = getViewportCenter(api.getAppState());
      await api.addImageElement({
        file,
        mimeType: file.type,
        x: origin.x - 200,
        y: origin.y - 200,
      });
      setIsDirty(true);
      event.target.value = '';
    },
    [],
  );

  const requestImageUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleExportPng = useCallback(async () => {
    if (!excalidrawRef.current || !activeBoard) {
      return;
    }
    const api = excalidrawRef.current;
    const blob = await exportToBlob({
      elements: api.getSceneElements(),
      appState: { ...sanitizeAppState(api.getAppState()), exportBackground: true },
      files: api.getFiles(),
      mimeType: 'image/png',
    });
    downloadBlob(blob, `${activeBoard.name.replace(/\s+/g, '_').toLowerCase()}_whiteboard.png`);
  }, [activeBoard]);

  const handleExportSvg = useCallback(async () => {
    if (!excalidrawRef.current || !activeBoard) {
      return;
    }
    const api = excalidrawRef.current;
    const svg = await exportToSvg({
      elements: api.getSceneElements(),
      appState: { ...sanitizeAppState(api.getAppState()), exportBackground: true },
      files: api.getFiles(),
    });
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    downloadBlob(blob, `${activeBoard.name.replace(/\s+/g, '_').toLowerCase()}_whiteboard.svg`);
  }, [activeBoard]);

  const handleExportJson = useCallback(() => {
    if (!excalidrawRef.current || !activeBoard) {
      return;
    }
    const api = excalidrawRef.current;
    const payload = {
      elements: api.getSceneElements(),
      appState: sanitizeAppState(api.getAppState()),
      files: filesMapToObject(api.getFiles()),
      name: activeBoard.name,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${activeBoard.name.replace(/\s+/g, '_').toLowerCase()}_whiteboard.json`);
  }, [activeBoard]);

  const handleShareBoard = useCallback(() => {
    handleExportJson();
  }, [handleExportJson]);

  return (
    <div className="whiteboard-page">
      <div className="whiteboard-header">
        <BackButton to="/tools" />
        <h1>Whiteboard</h1>
      </div>

      <div className="whiteboard-toolbar">
        <div className="whiteboard-toolbar__title">
          {activeBoard ? activeBoard.name : 'No boards'}
          {isDirty ? <span className="whiteboard-toolbar__dirty"> • Unsaved changes</span> : null}
        </div>
        <div className="whiteboard-toolbar__actions">
          <button type="button" onClick={handleSaveBoard} disabled={!activeBoard}>
            Save
          </button>
          <button type="button" onClick={handleLoadBoard} disabled={!activeBoard}>
            Load
          </button>
          <button type="button" onClick={handleExportPng} disabled={!activeBoard}>
            Export PNG
          </button>
          <button type="button" onClick={handleExportSvg} disabled={!activeBoard}>
            Export SVG
          </button>
          <button type="button" onClick={handleShareBoard} disabled={!activeBoard}>
            Share JSON
          </button>
        </div>
      </div>

      <div className="whiteboard-layout">
        <aside className="whiteboard-sidebar">
          <section className="whiteboard-sidebar__section">
            <div className="whiteboard-sidebar__header">
              <h2>Boards</h2>
              <button type="button" onClick={handleCreateBoard}>
                + New
              </button>
            </div>
            <ul className="whiteboard-board-list">
              {boards.map((board) => (
                <li key={board.id} className={board.id === activeBoardId ? 'active' : ''}>
                  <button type="button" onClick={() => requestSwitchBoard(board.id)}>
                    <span className="whiteboard-board__name">{board.name}</span>
                    <span className="whiteboard-board__meta">{new Date(board.updatedAt).toLocaleString()}</span>
                  </button>
                  <div className="whiteboard-board-list__actions">
                    <button type="button" onClick={() => handleDeleteBoard(board.id)} aria-label="Delete board">
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="whiteboard-sidebar__board-actions">
              <button type="button" onClick={handleRenameBoard} disabled={!activeBoard}>
                Rename
              </button>
              <button type="button" onClick={handleLoadBoard} disabled={!activeBoard}>
                Reset View
              </button>
            </div>
          </section>

          <section className="whiteboard-sidebar__section">
            <h2>Appearance</h2>
            <div className="whiteboard-theme-buttons">
              {THEMES.map((theme) => (
                <button key={theme.id} type="button" onClick={() => handleThemeChange(theme)}>
                  {theme.label}
                </button>
              ))}
            </div>
            <div className="whiteboard-background-swatches">
              {BACKGROUNDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="whiteboard-background-swatch"
                  style={{ backgroundColor: option.color }}
                  onClick={() => handleBackgroundChange(option.color)}
                  aria-label={`Switch background to ${option.label}`}
                />
              ))}
            </div>
            <div className="whiteboard-grid-buttons">
              {GRID_OPTIONS.map((option) => (
                <button key={option.id} type="button" onClick={() => handleGridChange(option)}>
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="whiteboard-sidebar__section">
            <h2>Tokens</h2>
            <div className="whiteboard-token-buttons">
              {PRESET_TOKENS.map((token) => (
                <button key={token.id} type="button" onClick={() => handleAddToken(token)}>
                  {token.label}
                </button>
              ))}
            </div>
          </section>

          <section className="whiteboard-sidebar__section">
            <h2>Rooms</h2>
            <div className="whiteboard-token-buttons">
              {PRESET_ROOMS.map((room) => (
                <button key={room.id} type="button" onClick={() => handleAddRoom(room)}>
                  {room.label}
                </button>
              ))}
            </div>
          </section>

          <section className="whiteboard-sidebar__section">
            <h2>Assets</h2>
            <div className="whiteboard-assets">
              <button type="button" onClick={requestImageUpload}>
                Upload Image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="whiteboard-file-input"
                onChange={handleImageUpload}
              />
            </div>
          </section>
        </aside>

        <div className="whiteboard-stage">
          <div className="whiteboard-stage__canvas">
            <Excalidraw excalidrawAPI={(api) => (excalidrawRef.current = api)} onChange={handleChange} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default WhiteboardPage;
