import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../sidebar.css';
import { Music, Dice1, Settings, BarChart2, Box, CircuitBoard, Menu, Users } from 'lucide-react';

export default function Sidebar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleNavigate = (path) => {
    navigate(path);
    setOpen(false);
  };

  const handleInvoke = (cmd, args) => {
    window.__TAURI__?.invoke(cmd, args);
    setOpen(false);
  };

  return (
    <>
      <nav id="sidebar" className={open ? 'open' : ''}>
        <button aria-label="Music Generator" onClick={() => handleNavigate('/generate')}>
          <Music strokeWidth={2} />
        </button>
        <button aria-label="D&D" onClick={() => handleNavigate('/dnd')}>
          <Dice1 strokeWidth={2} />
        </button>
        <button aria-label="Settings" onClick={() => handleNavigate('/settings')}>
          <Settings strokeWidth={2} />
        </button>
        <button aria-label="Profiles" onClick={() => handleNavigate('/profiles')}>
          <Users strokeWidth={2} />
        </button>
        <button aria-label="Train Model" onClick={() => handleNavigate('/train')}>
          <BarChart2 strokeWidth={2} />
        </button>
        <button aria-label="Manage Models" onClick={() => handleInvoke('open_path', { path: 'models' })}>
          <Box strokeWidth={2} />
        </button>
        <button aria-label="ONNX Crafter" onClick={() => handleNavigate('/onnx')}>
          <CircuitBoard strokeWidth={2} />
        </button>
      </nav>
      <button
        id="sidebar-toggle"
        aria-label="Toggle sidebar"
        onClick={() => setOpen(o => !o)}
      >
        <Menu strokeWidth={2} />
      </button>
    </>
  );
}

