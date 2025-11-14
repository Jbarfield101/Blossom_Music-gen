import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import FeatureWheel from '../components/FeatureWheel.jsx';
import Icon from '../components/Icon.jsx';
import Screen from '../components/Screen.jsx';
import useHardwareInfo from '../lib/useHardwareInfo.js';
import useSystemMetrics from '../lib/useSystemMetrics.js';
import './Dashboard.css';

const formatPercentText = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${Math.round(value)}%`;
};

const clampPercentValue = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
};

const shortenGpuName = (name) => {
  if (!name || typeof name !== 'string') return 'GPU';
  const trimmed = name.trim();
  if (!trimmed) return 'GPU';
  return trimmed
    .replace(/^NVIDIA\s+/i, '')
    .replace(/^GeForce\s+/i, '')
    .trim() || 'GPU';
};

const formatThroughput = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0 Mb/s';
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} Gb/s`;
  }
  return `${value.toFixed(1)} Mb/s`;
};

const formatFrequency = (mhz) => {
  if (typeof mhz !== 'number' || Number.isNaN(mhz) || mhz <= 0) return null;
  return `${(mhz / 1000).toFixed(2)} GHz`;
};

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
  const hardware = useHardwareInfo();
  const metrics = useSystemMetrics(2200);

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

  const metricsReady = metrics.status === 'ready' && metrics.snapshot;
  const usageSnapshot = metricsReady ? metrics.snapshot : null;
  const usageBlocks = usageSnapshot
    ? [
        {
          id: 'cpu',
          label: 'CPU',
          percent: usageSnapshot.cpu?.percent ?? null,
          detail:
            formatFrequency(usageSnapshot.cpu?.frequencyMhz ?? null) ??
            hardware.info?.cpu ??
            'CPU usage',
        },
        {
          id: 'gpu',
          label: shortenGpuName(
            usageSnapshot.gpu?.name ?? hardware.info?.gpu ?? 'GPU',
          ),
          percent: usageSnapshot.gpu?.percent ?? null,
          detail: usageSnapshot.gpu
            ? typeof usageSnapshot.gpu.memoryPercent === 'number'
              ? `${Math.round(usageSnapshot.gpu.memoryPercent)}% VRAM`
              : 'VRAM usage'
            : hardware.info?.gpu ?? 'GPU metrics',
        },
        {
          id: 'network',
          label: usageSnapshot.network
            ? usageSnapshot.network.interfaceType === 'wifi'
              ? 'Wi-Fi'
              : 'Ethernet'
            : 'Network',
          percent: usageSnapshot.network?.percent ?? null,
          detail: usageSnapshot.network
            ? `Down ${formatThroughput(usageSnapshot.network.rxMbps)} / Up ${formatThroughput(
                usageSnapshot.network.txMbps,
              )}`
            : 'Monitoring adapter',
        },
      ]
    : [];

  const hardwareDetails =
    hardware.status === 'ready' && hardware.info
      ? [
          { label: 'CPU', value: hardware.info.cpu },
          { label: 'GPU', value: hardware.info.gpu },
          { label: 'RAM', value: hardware.info.ram },
          { label: 'OS', value: hardware.info.os },
        ]
      : null;

  let hardwareNote = '';
  if (!hardwareDetails) {
    if (hardware.status === 'error') {
      hardwareNote = 'Hardware info unavailable right now.';
    } else if (hardware.status === 'unsupported') {
      hardwareNote = 'Launch the desktop app to see system hardware details.';
    } else {
      hardwareNote = 'Detecting your hardware.';
    }
  }

  let metricsNote = '';
  if (!usageBlocks.length) {
    if (metrics.status === 'unsupported') {
      metricsNote = 'Launch the desktop app to stream live usage.';
    } else if (metrics.status === 'error') {
      metricsNote = metrics.error || 'Hardware usage unavailable right now.';
    } else {
      metricsNote = 'Sampling performance data...';
    }
  }

  const comfyMessage =
    comfyStatus === 'online'
      ? 'ComfyUI is online. Kick off a new render from Sound Lab or Visual Generator.'
      : comfyStatus === 'starting'
        ? 'ComfyUI is warming up. Your ACE, lofi, and video jobs will queue as soon as it finishes booting.'
        : 'ComfyUI is offline. Open Settings → Advanced to relaunch it when you need it.';

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
        <div className="dashboard-stack">
          <div className="dashboard-hardware-card" data-status={hardware.status}>
            <div className="dashboard-hardware-heading">
              <div>
                <h2 className="dashboard-hardware-title">System hardware</h2>
                <p className="dashboard-hardware-subtitle">
                  Live CPU, GPU, and network usage from your rig.
                </p>
              </div>
            </div>
            {usageBlocks.length ? (
              <div className="dashboard-hardware-usage" aria-live="polite">
                {usageBlocks.map((block) => (
                  <div key={block.id} className="hardware-usage-block">
                    <div className="hardware-usage-header">
                      <span className="hardware-usage-label">{block.label}</span>
                      <span className="hardware-usage-percent">
                        {formatPercentText(block.percent)}
                      </span>
                    </div>
                    <div className="hardware-usage-bar" role="presentation">
                      <span
                        className="hardware-usage-bar-fill"
                        style={{ width: `${clampPercentValue(block.percent)}%` }}
                      />
                    </div>
                    {block.detail && (
                      <p className="hardware-usage-detail">{block.detail}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="dashboard-hardware-note">{metricsNote}</p>
            )}
            {hardwareDetails ? (
              <div className="dashboard-hardware-specs">
                {hardwareDetails.map(({ label, value }) => (
                  <dl key={label} className="dashboard-hardware-spec">
                    <dt className="dashboard-hardware-term">{label}</dt>
                    <dd className="dashboard-hardware-description">{value}</dd>
                  </dl>
                ))}
              </div>
            ) : (
              <p className="dashboard-hardware-note">{hardwareNote}</p>
            )}
          </div>
          <div className="screen-wrapper">
            <Screen data-comfy-status={comfyStatus}>
              <div className="dashboard-screen" aria-live="polite">
                <p className="dashboard-screen-copy">{comfyMessage}</p>
              </div>
            </Screen>
          </div>
        </div>
      </section>
    </>
  );
}

