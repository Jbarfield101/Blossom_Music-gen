import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

const DEFAULT_POLL_MS = 2000;
const MIN_POLL_MS = 750;

function normalizeMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || 'Unknown error';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(number, 0), 100);
}

function normalizeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeSnapshot(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const cpu = payload.cpu && typeof payload.cpu === 'object'
    ? {
        percent: clampPercent(payload.cpu.percent),
        frequencyMhz: normalizeNumber(payload.cpu.frequencyMhz),
      }
    : null;

  const memoryPercent =
    clampPercent(payload.memory?.percent) ??
    (() => {
      const used = normalizeNumber(payload.memory?.usedBytes);
      const total = normalizeNumber(payload.memory?.totalBytes);
      if (!used || !total || total <= 0) return null;
      return clampPercent((used / total) * 100);
    })();

  const memory = payload.memory && typeof payload.memory === 'object'
    ? {
        usedBytes: normalizeNumber(payload.memory.usedBytes, 0),
        totalBytes: normalizeNumber(payload.memory.totalBytes, 0),
        percent: memoryPercent,
      }
    : null;

  const gpu =
    payload.gpu && typeof payload.gpu === 'object'
      ? {
          name: typeof payload.gpu.name === 'string' && payload.gpu.name.trim()
            ? payload.gpu.name.trim()
            : 'GPU',
          percent: clampPercent(payload.gpu.percent),
          memoryPercent: clampPercent(payload.gpu.memoryPercent),
          memoryUsedMb: normalizeNumber(payload.gpu.memoryUsedMb),
          memoryTotalMb: normalizeNumber(payload.gpu.memoryTotalMb),
          temperatureC: normalizeNumber(payload.gpu.temperatureC),
        }
      : null;

  const network =
    payload.network && typeof payload.network === 'object'
      ? {
          interface: typeof payload.network.interface === 'string' && payload.network.interface.trim()
            ? payload.network.interface.trim()
            : 'Adapter',
          interfaceType:
            payload.network.interfaceType === 'wifi' ? 'wifi' : 'ethernet',
          rxMbps: normalizeNumber(payload.network.rxMbps, 0),
          txMbps: normalizeNumber(payload.network.txMbps, 0),
          percent: clampPercent(payload.network.percent),
          capacityMbps: normalizeNumber(payload.network.capacityMbps, 0) ?? 0,
        }
      : null;

  const timestamp =
    normalizeNumber(payload.timestampMs) ?? Date.now();

  return {
    timestamp,
    cpu,
    memory,
    gpu,
    network,
  };
}

export default function useSystemMetrics(pollIntervalMs = DEFAULT_POLL_MS) {
  const [state, setState] = useState(() => ({
    status: 'idle',
    snapshot: null,
    error: null,
  }));
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const interval = Math.max(
      MIN_POLL_MS,
      Number(pollIntervalMs) || DEFAULT_POLL_MS,
    );

    const clearPendingTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      clearPendingTimer();
      timerRef.current = setTimeout(runPoll, interval);
    };

    const runPoll = async () => {
      try {
        const raw = await invoke('system_usage_snapshot');
        if (cancelled) return;
        const snapshot = sanitizeSnapshot(raw);
        if (snapshot) {
          setState({ status: 'ready', snapshot, error: null });
        } else {
          setState({
            status: 'error',
            snapshot: null,
            error: 'Snapshot unavailable',
          });
        }
      } catch (error) {
        if (cancelled) return;
        setState({
          status: 'error',
          snapshot: null,
          error: normalizeMessage(error),
        });
      } finally {
        scheduleNext();
      }
    };

    (async () => {
      try {
        const native = await isTauri();
        if (!native) {
          setState({ status: 'unsupported', snapshot: null, error: null });
          return;
        }
      } catch {
        setState({ status: 'unsupported', snapshot: null, error: null });
        return;
      }

      setState((previous) =>
        previous.status === 'ready'
          ? previous
          : { status: 'loading', snapshot: previous.snapshot, error: null },
      );
      runPoll();
    })();

    return () => {
      cancelled = true;
      clearPendingTimer();
    };
  }, [pollIntervalMs]);

  return state;
}
