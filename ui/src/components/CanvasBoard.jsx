import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';

function NoteNode({ data }) {
  const { label, color, notes } = data || {};
  return (
    <div className="canvas-node canvas-node--note" style={{ borderColor: color || '#2563eb' }}>
      <div className="canvas-node__label">{label || 'Note'}</div>
      {notes ? <div className="canvas-node__notes">{notes}</div> : null}
    </div>
  );
}

function NpcNode({ data }) {
  const { label, color, notes } = data || {};
  const initials = useMemo(() => {
    if (!label) return 'NPC';
    return label
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .slice(0, 2)
      .join('');
  }, [label]);

  return (
    <div className="canvas-node canvas-node--npc" style={{ borderColor: color || '#7c3aed' }}>
      <div className="canvas-node__avatar" style={{ backgroundColor: color || '#7c3aed' }}>
        {initials || 'NPC'}
      </div>
      <div className="canvas-node__content">
        <div className="canvas-node__label">{label || 'Character'}</div>
        {notes ? <div className="canvas-node__notes">{notes}</div> : null}
      </div>
    </div>
  );
}

const NODE_TYPES = {
  noteNode: NoteNode,
  npcNode: NpcNode,
};

function assignRef(setLocalRef, forwardedRef) {
  return (node) => {
    setLocalRef(node);
    if (!forwardedRef) return;
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else {
      forwardedRef.current = node;
    }
  };
}

export default function CanvasBoard({
  nodes: externalNodes = [],
  edges: externalEdges = [],
  onNodesChange: notifyNodes,
  onEdgesChange: notifyEdges,
  onInit,
  wrapperRef,
  onSelectionChange,
}) {
  const combinedRef = useMemo(() => assignRef(() => {}, wrapperRef), [wrapperRef]);

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(externalNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(externalEdges);

  const [editingNode, setEditingNode] = useState(null);
  const [editingNodeDraft, setEditingNodeDraft] = useState({ label: '', color: '#2563eb', notes: '' });

  useEffect(() => {
    setNodes(externalNodes);
  }, [externalNodes, setNodes]);

  useEffect(() => {
    setEdges(externalEdges);
  }, [externalEdges, setEdges]);

  const handleNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);
        if (notifyNodes) {
          notifyNodes(updated);
        }
        return updated;
      });
    },
    [notifyNodes, setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => {
        const updated = applyEdgeChanges(changes, eds);
        if (notifyEdges) {
          notifyEdges(updated);
        }
        return updated;
      });
    },
    [notifyEdges, setEdges],
  );

  const handleConnect = useCallback(
    (connection) => {
      setEdges((eds) => {
        const relationship = window.prompt('Describe the relationship for this connection', '');
        const nextEdge = {
          ...connection,
          type: connection.type || 'default',
          data: { relationship: relationship || '' },
          label: relationship || 'Relation',
        };
        const updated = addEdge(nextEdge, eds);
        if (notifyEdges) {
          notifyEdges(updated);
        }
        return updated;
      });
    },
    [notifyEdges, setEdges],
  );

  const handleNodeDoubleClick = useCallback((_, node) => {
    setEditingNode(node);
    setEditingNodeDraft({
      label: node?.data?.label || '',
      color: node?.data?.color || '#2563eb',
      notes: node?.data?.notes || '',
    });
  }, []);

  const handleEdgeDoubleClick = useCallback((_, edge) => {
    const relationship = window.prompt('Update relationship description', edge?.data?.relationship || edge?.label || '');
    if (relationship === null) {
      return;
    }
    setEdges((eds) => {
      const updated = eds.map((existing) =>
        existing.id === edge.id
          ? {
              ...existing,
              data: { ...existing.data, relationship: relationship || '' },
              label: relationship || existing.label,
            }
          : existing,
      );
      if (notifyEdges) {
        notifyEdges(updated);
      }
      return updated;
    });
  }, [notifyEdges]);

  const closeEditor = useCallback(() => {
    setEditingNode(null);
  }, []);

  const handleEditorSubmit = useCallback(
    (event) => {
      event.preventDefault();
      if (!editingNode) return;
      setNodes((nds) => {
        const updated = nds.map((node) =>
          node.id === editingNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  label: editingNodeDraft.label || node.data?.label || '',
                  color: editingNodeDraft.color || node.data?.color,
                  notes: editingNodeDraft.notes || '',
                  type: node.data?.type || node.type,
                },
              }
            : node,
        );
        if (notifyNodes) {
          notifyNodes(updated);
        }
        return updated;
      });
      setEditingNode(null);
    },
    [editingNode, editingNodeDraft, notifyNodes, setNodes],
  );

  const nodeTypes = useMemo(() => NODE_TYPES, []);

  return (
    <div className="canvas-board" ref={combinedRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => {
          onNodesChangeInternal(changes);
          handleNodesChange(changes);
        }}
        onEdgesChange={(changes) => {
          onEdgesChangeInternal(changes);
          handleEdgesChange(changes);
        }}
        onConnect={handleConnect}
        onNodeDoubleClick={handleNodeDoubleClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onSelectionChange={onSelectionChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        fitView
        selectionOnDrag
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        panOnDrag
        panOnScroll
        zoomOnScroll
        zoomOnPinch
      >
        <Background gap={16} size={1} variant="dots" />
        <MiniMap pannable zoomable />
        <Controls showInteractive />
      </ReactFlow>

      {editingNode ? (
        <div className="canvas-node-editor">
          <form className="canvas-node-editor__panel" onSubmit={handleEditorSubmit}>
            <header className="canvas-node-editor__header">
              <h3>Edit Node</h3>
              <button type="button" onClick={closeEditor} aria-label="Close editor">
                ×
              </button>
            </header>
            <label className="canvas-node-editor__field">
              <span>Label</span>
              <input
                type="text"
                value={editingNodeDraft.label}
                onChange={(event) => setEditingNodeDraft((draft) => ({ ...draft, label: event.target.value }))}
              />
            </label>
            <label className="canvas-node-editor__field">
              <span>Color</span>
              <input
                type="color"
                value={editingNodeDraft.color}
                onChange={(event) => setEditingNodeDraft((draft) => ({ ...draft, color: event.target.value }))}
              />
            </label>
            <label className="canvas-node-editor__field">
              <span>Notes</span>
              <textarea
                rows="4"
                value={editingNodeDraft.notes}
                onChange={(event) => setEditingNodeDraft((draft) => ({ ...draft, notes: event.target.value }))}
              />
            </label>
            <div className="canvas-node-editor__actions">
              <button type="button" onClick={closeEditor} className="secondary">
                Cancel
              </button>
              <button type="submit" className="primary">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
