import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import BackButton from '../components/BackButton.jsx';
import CanvasBoard from '../components/CanvasBoard.jsx';
import './Canvas.css';

const STORAGE_KEY = 'blossom.canvas.boards';

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `board_${Date.now()}_${Math.round(Math.random() * 10_000)}`;
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
      return parsed;
    }
  } catch (error) {
    console.warn('Failed to load boards from localStorage', error);
  }
  return [];
}

function saveBoards(boards) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
  } catch (error) {
    console.warn('Failed to persist boards', error);
  }
}

const DEFAULT_NODE_COLORS = {
  noteNode: '#2563eb',
  npcNode: '#7c3aed',
};

export default function Canvas() {
  const [boards, setBoards] = useState(() => {
    const existing = loadBoards();
    if (existing.length > 0) {
      return existing;
    }
    const initial = {
      id: generateId(),
      name: 'Untitled Board',
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveBoards([initial]);
    return [initial];
  });
  const [currentBoardId, setCurrentBoardId] = useState(() => (boards[0] ? boards[0].id : null));
  const [nodes, setNodes] = useState(() => (boards[0] ? boards[0].nodes : []));
  const [edges, setEdges] = useState(() => (boards[0] ? boards[0].edges : []));
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    saveBoards(boards);
  }, [boards]);

  const currentBoard = useMemo(
    () => boards.find((board) => board.id === currentBoardId) || null,
    [boards, currentBoardId],
  );

  const isDirty = useMemo(() => {
    if (!currentBoard) return false;
    try {
      return (
        JSON.stringify(currentBoard.nodes ?? []) !== JSON.stringify(nodes ?? []) ||
        JSON.stringify(currentBoard.edges ?? []) !== JSON.stringify(edges ?? [])
      );
    } catch (error) {
      console.warn('Failed to diff board state', error);
      return true;
    }
  }, [currentBoard, nodes, edges]);

  const selectBoard = useCallback(
    (boardId) => {
      if (boardId === currentBoardId) return;
      if (isDirty) {
        const proceed = window.confirm('You have unsaved changes. Continue without saving?');
        if (!proceed) {
          return;
        }
      }
      const board = boards.find((item) => item.id === boardId);
      if (!board) return;
      setCurrentBoardId(board.id);
      setNodes(board.nodes ?? []);
      setEdges(board.edges ?? []);
    },
    [boards, currentBoardId, isDirty],
  );

  const handleCreateBoard = useCallback(() => {
    const name = window.prompt('Name for the new board', `Board ${boards.length + 1}`);
    if (name === null) {
      return;
    }
    const boardName = name.trim() || `Board ${boards.length + 1}`;
    const newBoard = {
      id: generateId(),
      name: boardName,
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setBoards((prev) => [...prev, newBoard]);
    setCurrentBoardId(newBoard.id);
    setNodes([]);
    setEdges([]);
  }, [boards.length]);

  const handleRenameBoard = useCallback(() => {
    if (!currentBoard) return;
    const name = window.prompt('Rename board', currentBoard.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBoards((prev) =>
      prev.map((board) => (board.id === currentBoard.id ? { ...board, name: trimmed } : board)),
    );
  }, [currentBoard]);

  const handleDeleteBoard = useCallback(
    (boardId) => {
      const board = boards.find((item) => item.id === boardId);
      if (!board) return;
      const confirmMessage = boardId === currentBoardId ? 'Delete current board?' : `Delete "${board.name}"?`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
      setBoards((prev) => prev.filter((item) => item.id !== boardId));
      if (boardId === currentBoardId) {
        const remaining = boards.filter((item) => item.id !== boardId);
        const nextBoard = remaining[0] ?? null;
        setCurrentBoardId(nextBoard ? nextBoard.id : null);
        setNodes(nextBoard ? nextBoard.nodes : []);
        setEdges(nextBoard ? nextBoard.edges : []);
      }
    },
    [boards, currentBoardId],
  );

  const handleSaveBoard = useCallback(() => {
    if (!currentBoardId) return;
    setBoards((prev) =>
      prev.map((board) =>
        board.id === currentBoardId
          ? {
              ...board,
              nodes,
              edges,
              updatedAt: new Date().toISOString(),
            }
          : board,
      ),
    );
  }, [currentBoardId, nodes, edges]);

  const handleLoadBoard = useCallback(() => {
    if (!currentBoard) return;
    setNodes(currentBoard.nodes ?? []);
    setEdges(currentBoard.edges ?? []);
  }, [currentBoard]);

  const handleAddNode = useCallback(
    (type) => {
      const id = `node_${Date.now()}_${Math.round(Math.random() * 10_000)}`;
      const color = DEFAULT_NODE_COLORS[type] || '#2563eb';
      const baseData = type === 'npcNode'
        ? { label: 'New NPC', type: 'npc', color, notes: 'Describe this character...' }
        : { label: 'New Note', type: 'note', color, notes: 'Add context or reminders here.' };

      let position = { x: 0, y: 0 };
      if (reactFlowInstance && wrapperRef.current) {
        const bounds = wrapperRef.current.getBoundingClientRect();
        position = reactFlowInstance.project({
          x: bounds.width / 2,
          y: bounds.height / 2,
        });
      } else {
        position = { x: Math.random() * 200, y: Math.random() * 200 };
      }

      const newNode = {
        id,
        type,
        position,
        data: baseData,
      };
      setNodes((prev) => [...prev, newNode]);
    },
    [reactFlowInstance],
  );

  const handleFitView = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.2, duration: 400 });
    }
  }, [reactFlowInstance]);

  const handleExport = useCallback(async () => {
    if (!wrapperRef.current) return;
    try {
      const canvas = await html2canvas(wrapperRef.current, {
        backgroundColor: '#0f172a',
        useCORS: true,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      const filename = currentBoard ? `${currentBoard.name.replace(/\s+/g, '_')}.png` : 'canvas.png';
      link.download = filename;
      link.click();
    } catch (error) {
      console.error('Failed to export canvas', error);
    }
  }, [currentBoard]);

  const toolbarLabel = currentBoard ? `${currentBoard.name}${isDirty ? ' *' : ''}` : 'Canvas';

  return (
    <div className="canvas-page">
      <BackButton />
      <div className="canvas-toolbar">
        <div className="canvas-toolbar__title">{toolbarLabel}</div>
        <div className="canvas-toolbar__actions">
          <button type="button" onClick={handleSaveBoard} disabled={!currentBoardId}>
            Save
          </button>
          <button type="button" onClick={handleLoadBoard} disabled={!currentBoardId}>
            Load
          </button>
          <button type="button" onClick={handleFitView}>
            Fit View
          </button>
          <button type="button" onClick={handleExport} disabled={!currentBoardId}>
            Export PNG
          </button>
        </div>
      </div>
      <div className="canvas-layout">
        <aside className="canvas-sidebar">
          <div className="canvas-sidebar__section">
            <div className="canvas-sidebar__header">
              <h2>Boards</h2>
              <button type="button" onClick={handleCreateBoard}>
                + New
              </button>
            </div>
            <ul className="canvas-board-list">
              {boards.map((board) => (
                <li key={board.id} className={board.id === currentBoardId ? 'active' : ''}>
                  <button type="button" onClick={() => selectBoard(board.id)}>
                    {board.name}
                  </button>
                  <div className="canvas-board-list__actions">
                    <button type="button" onClick={() => handleDeleteBoard(board.id)} aria-label="Delete board">
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="canvas-sidebar__board-actions">
              <button type="button" onClick={handleRenameBoard} disabled={!currentBoardId}>
                Rename
              </button>
            </div>
          </div>
          <div className="canvas-sidebar__section">
            <h2>Nodes</h2>
            <div className="canvas-node-buttons">
              <button type="button" onClick={() => handleAddNode('noteNode')}>
                ➕ Note
              </button>
              <button type="button" onClick={() => handleAddNode('npcNode')}>
                🧙 NPC
              </button>
            </div>
          </div>
        </aside>
        <main className="canvas-stage">
          <CanvasBoard
            nodes={nodes}
            edges={edges}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onInit={setReactFlowInstance}
            wrapperRef={wrapperRef}
          />
        </main>
      </div>
    </div>
  );
}
