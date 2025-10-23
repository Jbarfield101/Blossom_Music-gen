import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import FeatureWheel from '../components/FeatureWheel.jsx';
import Icon from '../components/Icon.jsx';
import Screen from '../components/Screen.jsx';
import './Dashboard.css';

export default function Dashboard() {
  const [version, setVersion] = useState("");
  const [comfyStatus, setComfyStatus] = useState('offline');
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true,
  );
  const comfyPollTimerRef = useRef(null);
  const comfyFailureCountRef = useRef(0);
  const comfySeenSuccessRef = useRef(false);
  const isTauriEnvRef = useRef(false);

  const clearComfyPollTimer = () => {
    if (comfyPollTimerRef.current) {
      clearTimeout(comfyPollTimerRef.current);
      comfyPollTimerRef.current = null;
    }
  };

  useEffect(() => {
    const updateOnlineStatus = () => {
      if (typeof navigator === 'undefined') return;
      setIsOnline(Boolean(navigator.onLine));
    };

    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await invoke('app_version');
        // res is expected to be { app: string, python: string }
        const appVer = (res && res.app) ? String(res.app) : "";
        if (mounted) setVersion(appVer);
      } catch {
        // ignore; leave version blank
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const MAX_FAILURES = 3;

    const refreshComfyStatus = async (ensureLaunch) => {
      if (!isTauriEnvRef.current || cancelled) return;
      try {
        const result = await invoke('comfyui_status', { ensureRunning: ensureLaunch });
        if (cancelled) return;
        comfyFailureCountRef.current = 0;
        comfySeenSuccessRef.current = true;
        const isRunning = Boolean(result?.running);
        setComfyStatus(isRunning ? 'online' : 'offline');
      } catch (err) {
        if (cancelled) return;
        const failureCount = comfyFailureCountRef.current + 1;
        comfyFailureCountRef.current = failureCount;

        if (!comfySeenSuccessRef.current) {
          setComfyStatus(failureCount >= MAX_FAILURES ? 'offline' : 'starting');
        } else if (failureCount >= MAX_FAILURES) {
          setComfyStatus('error');
        } else {
          setComfyStatus('offline');
        }
        console.warn('Failed to refresh ComfyUI status', err);
      }
    };

    const scheduleNextPoll = () => {
      if (!isTauriEnvRef.current || cancelled) return;
      clearComfyPollTimer();
      comfyPollTimerRef.current = setTimeout(async () => {
        await refreshComfyStatus(false);
        scheduleNextPoll();
      }, 8000);
    };

    (async () => {
      try {
        const runningInTauri = await isTauri();
        if (cancelled || !runningInTauri) return;
        isTauriEnvRef.current = true;
      } catch {
        return;
      }

      setComfyStatus((prev) => (prev === 'online' ? prev : 'starting'));
      await refreshComfyStatus(true);
      if (!cancelled) {
        scheduleNextPoll();
      }
    })();

    return () => {
      cancelled = true;
      clearComfyPollTimer();
    };
  }, []);

  const internetStatus = isOnline ? 'online' : 'offline';
  const comfyIndicatorStatus =
    comfyStatus === 'online'
      ? 'online'
      : comfyStatus === 'starting'
        ? 'starting'
        : 'offline';

  const statusIndicators = [
    {
      id: 'internet',
      label: 'Internet',
      value: isOnline ? 'Online' : 'Offline',
      status: internetStatus,
      icon: isOnline ? 'Wifi' : 'WifiOff',
    },
    {
      id: 'comfy',
      label: 'ComfyUI',
      value:
        comfyIndicatorStatus === 'starting'
          ? 'Starting'
          : comfyIndicatorStatus === 'online'
            ? 'Online'
            : 'Offline',
      status: comfyIndicatorStatus,
      icon:
        comfyIndicatorStatus === 'starting'
          ? 'Loader2'
          : comfyIndicatorStatus === 'online'
            ? 'Camera'
            : 'CameraOff',
      spin: comfyIndicatorStatus === 'starting',
    },
  ];
  const items = [
    { to: '/musicgen', icon: 'Music', title: 'Sound Lab' },
    { to: '/calendar', icon: 'CalendarDays', title: 'Calendar' },
    { to: '/dnd', icon: 'Dice5', title: 'Dungeons & Dragons' },
    { to: '/games', icon: 'Gamepad2', title: 'Games' },
    { to: '/tools', icon: 'Wrench', title: 'Tools' },
    { to: '/gallery', icon: 'Images', title: 'Gallery' },
    { to: '/visual-generator', icon: 'Palette', title: 'Visual Generator' },
    { to: '/settings', icon: 'Settings', title: 'Settings' },
  ];

  return (
    <>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Blossom</h1>
        {version && <div className="dashboard-version">v{version}</div>}
        <ul className="dashboard-status-icons" aria-label="System status">
          {statusIndicators.map((indicator) => (
            <li
              key={indicator.id}
              className={`status-indicator status-indicator--${indicator.status}`}
              aria-label={`${indicator.label} ${indicator.value}`}
              title={`${indicator.label} ${indicator.value}`}
            >
              <Icon
                name={indicator.icon}
                size={18}
                className={`status-icon${indicator.spin ? ' status-icon--spin' : ''}`}
              />
              <div className="status-copy">
                <span className="status-label">{indicator.label}</span>
                <span className="status-value">{indicator.value}</span>
              </div>
            </li>
          ))}
        </ul>
      </header>
      <section className="dashboard-main">
        <FeatureWheel items={items} />
        <div className="screen-wrapper">
          <Screen data-comfy-status={comfyStatus}>
          </Screen>
        </div>
      </section>
    </>
  );
}

