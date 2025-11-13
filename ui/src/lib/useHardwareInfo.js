import { useEffect, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';

let cachedInfo = null;
let cachedError = null;
let inflightHardwarePromise = null;
let inflightEnvPromise = null;
let tauriEnvironment = null;

function normalizeMessage(error) {
  if (!error) {
    return 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sanitizeHardwareInfo(payload) {
  const fallback = (value, placeholder) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    return placeholder;
  };

  if (!payload || typeof payload !== 'object') {
    return {
      cpu: 'Unknown CPU',
      gpu: 'Unknown GPU',
      ram: 'Unknown RAM',
      os: 'Unknown OS',
    };
  }

  return {
    cpu: fallback(payload.cpu, 'Unknown CPU'),
    gpu: fallback(payload.gpu, 'Unknown GPU'),
    ram: fallback(payload.ram, 'Unknown RAM'),
    os: fallback(payload.os, 'Unknown OS'),
  };
}

async function ensureTauriEnvironment() {
  if (tauriEnvironment !== null) {
    return tauriEnvironment;
  }
  if (!inflightEnvPromise) {
    inflightEnvPromise = (async () => {
      try {
        const result = await isTauri();
        tauriEnvironment = Boolean(result);
      } catch {
        tauriEnvironment = false;
      }
      inflightEnvPromise = null;
      return tauriEnvironment;
    })();
  }
  return inflightEnvPromise;
}

async function loadHardwareInfo() {
  if (cachedInfo) {
    return cachedInfo;
  }
  if (cachedError) {
    throw cachedError;
  }
  if (!inflightHardwarePromise) {
    inflightHardwarePromise = (async () => {
      try {
        const result = await invoke('system_hardware_info');
        const normalized = sanitizeHardwareInfo(result);
        cachedInfo = normalized;
        cachedError = null;
        return normalized;
      } catch (error) {
        const message = normalizeMessage(error);
        cachedError = message;
        throw message;
      } finally {
        inflightHardwarePromise = null;
      }
    })();
  }
  return inflightHardwarePromise;
}

export default function useHardwareInfo() {
  const [state, setState] = useState(() => {
    if (cachedInfo) {
      return { status: 'ready', info: cachedInfo, error: null };
    }
    if (cachedError) {
      return { status: 'error', info: null, error: cachedError };
    }
    if (tauriEnvironment === false) {
      return { status: 'unsupported', info: null, error: null };
    }
    return { status: 'idle', info: null, error: null };
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const isNative = await ensureTauriEnvironment();
      if (cancelled) return;

      if (!isNative) {
        setState({ status: 'unsupported', info: null, error: null });
        return;
      }

      if (!cachedInfo) {
        setState((previous) =>
          previous.status === 'ready'
            ? previous
            : { status: 'loading', info: previous.info, error: null },
        );
      }

      try {
        const info = await loadHardwareInfo();
        if (cancelled) return;
        setState({ status: 'ready', info, error: null });
      } catch (error) {
        if (cancelled) return;
        const message = normalizeMessage(error);
        setState({ status: 'error', info: null, error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
