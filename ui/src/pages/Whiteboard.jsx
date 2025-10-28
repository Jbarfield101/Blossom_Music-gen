import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import BackButton from '../components/BackButton.jsx';
import './Whiteboard.css';

const STORAGE_KEY = 'blossom.whiteboard.scenes';
const DEFAULT_BACKGROUND = '#0f172a';
const DEFAULT_APP_STATE = {
  viewBackgroundColor: DEFAULT_BACKGROUND,
  theme: 'dark',
  gridSize: 0,
  gridMode: 'grid',
  zenModeEnabled: false,
  viewModeEnabled: false,
};

const BACKGROUND_OPTIONS = [
  '#0f172a',
  '#111827',
  '#0c4a6e',
  '#083344',
  '#3b0764',
  '#7c2d12',
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
    width: 520,
    height: 360,
    strokeColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.18)',
  },
  {
    id: 'dungeon',
    label: 'Dungeon Chamber',
    width: 480,
    height: 460,
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

function loadScenes() {
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
      return parsed;
    }
  } catch (error) {
    console.warn('Failed to load whiteboards from storage', error);
  }
  return [];
}

function saveScenes(scenes) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes));
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
  return JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        Array.from(files.entries()).map(([fileId, data]) => [fileId, { ...data }]),
      ),
    ),
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

function createTokenElements(preset) {
  const baseX = 140 + Math.random() * 180;
  const baseY = 140 + Math.random() * 180;
  const ellipse = createBaseShape({
    type: 'ellipse',
    x: baseX,
    y: baseY,
    width: 140,
    height: 140,
    strokeColor: preset.color,
    backgroundColor: preset.fill,
  });
  const label = createTextElement({
    text: preset.text,
    x: baseX + 20,
    y: baseY + 46,
    color: preset.color,
  });
  return [ellipse, label];
}

function createRoomElements(preset) {
  const originX = 120 + Math.random() * 160;
  const originY = 120 + Math.random() * 160;
  const room = createBaseShape({
    type: 'rectangle',
    x: originX,
    y: originY,
    width: preset.width,
    height: preset.height,
    strokeColor: preset.strokeColor,
    backgroundColor: preset.backgroundColor,
  });
  const label = createTextElement({
    text: preset.label,
    x: originX + preset.width / 2 - 80,
    y: originY - 56,
    color: preset.strokeColor,
  });
  return [room, label];
}

export default function Whiteboard() {
  const excalidrawRef = useRef(null);
  const fileInputRef = useRef(null);
  const [scenes, setScenes] = useState(() => {
    const existing = loadScenes();
    if (existing.length > 0) {
      return existing;
    }
    const now = new Date().toISOString();
    const initial = {
      id: generateId(),
      name: 'Untitled Board',
      createdAt: now,
      updatedAt: now,
      elements: [],
      appState: { ...DEFAULT_APP_STATE },
      files: {},
    };
    saveScenes([initial]);
    return [initial];
  });
  const [currentSceneId, setCurrentSceneId] = useState(() => (scenes[0] ? scenes[0].id : null));
  const [sceneSnapshot, setSceneSnapshot] = useState(() => ({
    elements: scenes[0]?.elements ?? [],
    appState: scenes[0]?.appState ?? { ...DEFAULT_APP_STATE },
    files: scenes[0]?.files ?? {},
  }));

  useEffect(() => {
    saveScenes(scenes);
  }, [scenes]);

  const currentScene = useMemo(() => {
    if (!scenes.length) {
      return null;
    }
    return scenes.find((scene) => scene.id === currentSceneId) ?? scenes[0];
  }, [scenes, currentSceneId]);

  useEffect(() => {
    if (!currentScene) {
      return;
    }
    setSceneSnapshot({
      elements: currentScene.elements ?? [],
      appState: { ...DEFAULT_APP_STATE, ...(currentScene.appState ?? {}) },
      files: currentScene.files ?? {},
    });
    if (excalidrawRef.current) {
      excalidrawRef.current.updateScene({
        elements: currentScene.elements ?? [],
        appState: { ...DEFAULT_APP_STATE, ...(currentScene.appState ?? {}) },
        files: filesObjectToMap(currentScene.files ?? {}),
      });
    }
  }, [currentScene, currentSceneId]);

  const isDirty = useMemo(() => {
    if (!currentScene) {
      return sceneSnapshot.elements.length > 0;
    }
    try {
      return (
        JSON.stringify(sceneSnapshot.elements ?? []) !== JSON.stringify(currentScene.elements ?? []) ||
        JSON.stringify(sceneSnapshot.appState ?? {}) !== JSON.stringify(currentScene.appState ?? {}) ||
        JSON.stringify(sceneSnapshot.files ?? {}) !== JSON.stringify(currentScene.files ?? {})
      );
    } catch (error) {
      console.warn('Failed to diff whiteboard state', error);
      return true;
    }
  }, [currentScene, sceneSnapshot]);

  const handleSceneChange = useCallback((elements, appState, files) => {
    setSceneSnapshot({
      elements: JSON.parse(JSON.stringify(elements ?? [])),
      appState: sanitizeAppState(appState),
      files: filesMapToObject(files),
    });
  }, []);

  const handleSelectScene = useCallback(
    (sceneId) => {
      if (sceneId === currentSceneId) {
        return;
      }
      if (isDirty) {
        const proceed = window.confirm('You have unsaved changes. Continue without saving?');
        if (!proceed) {
          return;
        }
      }
      const targetScene = scenes.find((scene) => scene.id === sceneId);
      if (!targetScene) {
        return;
      }
      setCurrentSceneId(sceneId);
    },
    [currentSceneId, isDirty, scenes],
  );

  const handleCreateScene = useCallback(() => {
    const name = window.prompt('Name for the new whiteboard', `Board ${scenes.length + 1}`);
    if (name === null) {
      return;
    }
    const boardName = name.trim() || `Board ${scenes.length + 1}`;
    const now = new Date().toISOString();
    const newScene = {
      id: generateId(),
      name: boardName,
      createdAt: now,
      updatedAt: now,
      elements: [],
      appState: { ...DEFAULT_APP_STATE },
      files: {},
    };
    setScenes((prev) => [...prev, newScene]);
    setCurrentSceneId(newScene.id);
    setSceneSnapshot({ elements: [], appState: { ...DEFAULT_APP_STATE }, files: {} });
    if (excalidrawRef.current) {
      excalidrawRef.current.resetScene({
        elements: [],
        appState: { ...DEFAULT_APP_STATE },
        files: new Map(),
      });
    }
  }, [scenes.length]);

  const handleRenameScene = useCallback(() => {
    if (!currentScene) {
      return;
    }
    const name = window.prompt('Rename whiteboard', currentScene.name);
    if (name === null) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setScenes((prev) =>
      prev.map((scene) =>
        scene.id === currentScene.id
          ? {
              ...scene,
              name: trimmed.slice(0, 80),
              updatedAt: new Date().toISOString(),
            }
          : scene,
      ),
    );
  }, [currentScene]);

  const handleDeleteScene = useCallback(
    (sceneId) => {
      const scene = scenes.find((item) => item.id === sceneId);
      if (!scene) {
        return;
      }
      const message = sceneId === currentSceneId ? 'Delete current whiteboard?' : `Delete "${scene.name}"?`;
      if (!window.confirm(message)) {
        return;
      }
      setScenes((prev) => prev.filter((item) => item.id !== sceneId));
      if (sceneId === currentSceneId) {
        const remaining = scenes.filter((item) => item.id !== sceneId);
        const nextScene = remaining[0] ?? null;
        setCurrentSceneId(nextScene ? nextScene.id : null);
        setSceneSnapshot({
          elements: nextScene?.elements ?? [],
          appState: { ...DEFAULT_APP_STATE, ...(nextScene?.appState ?? {}) },
          files: nextScene?.files ?? {},
        });
        if (excalidrawRef.current) {
          excalidrawRef.current.updateScene({
            elements: nextScene?.elements ?? [],
            appState: { ...DEFAULT_APP_STATE, ...(nextScene?.appState ?? {}) },
            files: filesObjectToMap(nextScene?.files ?? {}),
          });
        }
      }
    },
    [currentSceneId, scenes],
  );

  const handleSaveScene = useCallback(() => {
    if (!currentScene) {
      return;
    }
    const now = new Date().toISOString();
    setScenes((prev) =>
      prev.map((scene) =>
        scene.id === currentScene.id
          ? {
              ...scene,
              updatedAt: now,
              elements: JSON.parse(JSON.stringify(sceneSnapshot.elements ?? [])),
              appState: JSON.parse(JSON.stringify(sceneSnapshot.appState ?? {})),
              files: JSON.parse(JSON.stringify(sceneSnapshot.files ?? {})),
            }
          : scene,
      ),
    );
  }, [currentScene, sceneSnapshot]);

  const handleLoadScene = useCallback(() => {
    if (!currentScene || !excalidrawRef.current) {
      return;
    }
    excalidrawRef.current.updateScene({
      elements: currentScene.elements ?? [],
      appState: { ...DEFAULT_APP_STATE, ...(currentScene.appState ?? {}) },
      files: filesObjectToMap(currentScene.files ?? {}),
    });
  }, [currentScene]);

  const handleThemeChange = useCallback((theme) => {
    if (!excalidrawRef.current) {
      return;
    }
    excalidrawRef.current.setAppState({ theme });
  }, []);

  const handleBackgroundChange = useCallback((color) => {
    if (!excalidrawRef.current) {
      return;
    }
    excalidrawRef.current.setAppState({ viewBackgroundColor: color });
  }, []);

  const handleToggleOverlay = useCallback((mode) => {
    if (!excalidrawRef.current) {
      return;
    }
    const appState = excalidrawRef.current.getAppState();
    const isActive =
      (appState.gridSize ?? 0) > 0 && (appState.gridMode ?? 'grid') === mode;
    if (isActive) {
      excalidrawRef.current.setAppState({ gridSize: 0 });
    } else {
      excalidrawRef.current.setAppState({ gridSize: 20, gridMode: mode });
    }
  }, []);

  const handleAddToken = useCallback((preset) => {
    if (!excalidrawRef.current) {
      return;
    }
    const existing = excalidrawRef.current.getSceneElements() ?? [];
    const additions = createTokenElements(preset);
    excalidrawRef.current.updateScene({
      elements: [...existing, ...additions],
    });
  }, []);

  const handleAddRoom = useCallback((preset) => {
    if (!excalidrawRef.current) {
      return;
    }
    const existing = excalidrawRef.current.getSceneElements() ?? [];
    const additions = createRoomElements(preset);
    excalidrawRef.current.updateScene({
      elements: [...existing, ...additions],
    });
  }, []);

  const handleUploadImage = useCallback(
    async (event) => {
      const { files } = event.target;
      if (!files || !files.length || !excalidrawRef.current) {
        return;
      }
      const fileList = Array.from(files).filter((file) => file.type.startsWith('image/'));
      if (!fileList.length) {
        return;
      }
      const api = excalidrawRef.current;
      const toDataUrl = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      try {
        for (const file of fileList) {
          const dataURL = await toDataUrl(file);
          await api.addImageElement({
            file: {
              id: generateId('image'),
              dataURL,
              mimeType: file.type || 'image/png',
              created: Date.now(),
              lastRetrieved: Date.now(),
              name: file.name,
            },
          });
        }
      } catch (error) {
        console.error('Failed to add image', error);
      } finally {
        event.target.value = '';
      }
    },
    [],
  );

  const handleExportPng = useCallback(async () => {
    if (!excalidrawRef.current) {
      return;
    }
    try {
      const elements = excalidrawRef.current.getSceneElements();
      const appState = excalidrawRef.current.getAppState();
      const files = excalidrawRef.current.getFiles();
      const blob = await exportToBlob({
        elements,
        appState,
        files,
        mimeType: 'image/png',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = (currentScene?.name || 'whiteboard').replace(/\s+/g, '_');
      link.download = `${filename}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export PNG', error);
    }
  }, [currentScene]);

  const handleExportSvg = useCallback(async () => {
    if (!excalidrawRef.current) {
      return;
    }
    try {
      const elements = excalidrawRef.current.getSceneElements();
      const appState = excalidrawRef.current.getAppState();
      const files = excalidrawRef.current.getFiles();
      const svgElement = await exportToSvg({
        elements,
        appState,
        files,
      });
      const serializer = new XMLSerializer();
      const svgData = serializer.serializeToString(svgElement);
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = (currentScene?.name || 'whiteboard').replace(/\s+/g, '_');
      link.download = `${filename}.svg`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export SVG', error);
    }
  }, [currentScene]);

  const handleShareJson = useCallback(() => {
    const payload = {
      id: currentScene?.id ?? generateId(),
      name: currentScene?.name ?? 'whiteboard',
      updatedAt: new Date().toISOString(),
      elements: sceneSnapshot.elements ?? [],
      appState: sceneSnapshot.appState ?? {},
      files: sceneSnapshot.files ?? {},
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = (currentScene?.name || 'whiteboard').replace(/\s+/g, '_');
      link.download = `${filename}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export JSON', error);
    }
  }, [currentScene, sceneSnapshot]);

  const currentAppState = sceneSnapshot.appState ?? DEFAULT_APP_STATE;
  const currentBackground = currentAppState.viewBackgroundColor ?? DEFAULT_BACKGROUND;
  const currentTheme = currentAppState.theme ?? DEFAULT_APP_STATE.theme;
  const isGridActive = (currentAppState.gridSize ?? 0) > 0 && (currentAppState.gridMode ?? 'grid') === 'grid';
  const isDotsActive = (currentAppState.gridSize ?? 0) > 0 && (currentAppState.gridMode ?? 'grid') === 'dot';
  const toolbarLabel = currentScene ? `${currentScene.name}${isDirty ? ' *' : ''}` : 'Whiteboard';

  return (
    <div className="whiteboard-page">
      <BackButton />
      <div className="whiteboard-toolbar">
        <div className="whiteboard-toolbar__title">{toolbarLabel}</div>
        <div className="whiteboard-toolbar__actions">
          <button type="button" onClick={handleSaveScene} disabled={!currentScene}>
            Save
          </button>
          <button type="button" onClick={handleLoadScene} disabled={!currentScene}>
            Load
          </button>
          <button type="button" onClick={handleExportPng} disabled={!currentScene}>
            Export PNG
          </button>
          <button type="button" onClick={handleExportSvg} disabled={!currentScene}>
            Export SVG
          </button>
          <button type="button" onClick={handleShareJson} disabled={!currentScene}>
            Share JSON
          </button>
        </div>
      </div>
      <div className="whiteboard-layout">
        <aside className="whiteboard-sidebar">
          <div className="whiteboard-sidebar__section">
            <div className="whiteboard-sidebar__header">
              <h2>Boards</h2>
              <button type="button" onClick={handleCreateScene}>
                + New
              </button>
            </div>
            <ul className="whiteboard-board-list">
              {scenes.map((scene) => (
                <li key={scene.id} className={scene.id === currentScene?.id ? 'active' : ''}>
                  <button type="button" onClick={() => handleSelectScene(scene.id)}>
                    {scene.name}
                  </button>
                  <div className="whiteboard-board-list__actions">
                    <button type="button" onClick={() => handleDeleteScene(scene.id)} aria-label="Delete board">
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="whiteboard-sidebar__board-actions">
              <button type="button" onClick={handleRenameScene} disabled={!currentScene}>
                Rename
              </button>
            </div>
          </div>
          <div className="whiteboard-sidebar__section">
            <h2>Theme & Grid</h2>
            <div className="whiteboard-theme-buttons">
              <button
                type="button"
                className={currentTheme === 'dark' ? 'active' : ''}
                onClick={() => handleThemeChange('dark')}
              >
                Dark
              </button>
              <button
                type="button"
                className={currentTheme === 'light' ? 'active' : ''}
                onClick={() => handleThemeChange('light')}
              >
                Light
              </button>
            </div>
            <div className="whiteboard-grid-buttons">
              <button
                type="button"
                className={isGridActive ? 'active' : ''}
                onClick={() => handleToggleOverlay('grid')}
              >
                Grid
              </button>
              <button
                type="button"
                className={isDotsActive ? 'active' : ''}
                onClick={() => handleToggleOverlay('dot')}
              >
                Dots
              </button>
            </div>
            <div className="whiteboard-background-picker">
              {BACKGROUND_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={color === currentBackground ? 'active' : ''}
                  style={{ background: color }}
                  onClick={() => handleBackgroundChange(color)}
                  aria-label={`Set background ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="whiteboard-sidebar__section">
            <h2>Preset Tokens</h2>
            <div className="whiteboard-token-buttons">
              {PRESET_TOKENS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => handleAddToken(preset)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="whiteboard-sidebar__section">
            <h2>Room Layouts</h2>
            <div className="whiteboard-token-buttons">
              {PRESET_ROOMS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => handleAddRoom(preset)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="whiteboard-sidebar__section">
            <h2>Images</h2>
            <div className="whiteboard-image-uploader">
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                Upload PNG / JPG
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={handleUploadImage}
              />
            </div>
          </div>
        </aside>
        <main className="whiteboard-stage">
          <div className="whiteboard-stage__canvas">
            <Excalidraw
              ref={excalidrawRef}
              initialData={{
                elements: currentScene?.elements ?? [],
                appState: { ...DEFAULT_APP_STATE, ...(currentScene?.appState ?? {}) },
                files: filesObjectToMap(currentScene?.files ?? {}),
              }}
              onChange={handleSceneChange}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
