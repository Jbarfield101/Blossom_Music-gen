import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';

const STORAGE_FILE = 'ui-shared-state.json';
const STORAGE_KEY = 'sharedState';
const LOCAL_STORAGE_KEY = 'blossom.ui.sharedState';

export const DEFAULT_MUSICGEN_FORM = Object.freeze({
  prompt: 'Slow lofi beat, 60 BPM, warm Rhodes, vinyl crackle, soft snare, cozy night mood',
  duration: 30,
  temperature: 1,
  modelName: 'small',
  name: '',
  melodyPath: '',
  forceCpu: false,
  forceGpu: false,
  useFp16: false,
  count: 1,
});

export const DEFAULT_LOOPMAKER_FORM = Object.freeze({
  targetSeconds: 3600,
  targetInput: '3600',
  outputFormat: 'video/mp4;codecs=h264,aac',
});

export const DEFAULT_BEATMAKER_FORM = Object.freeze({
  loopInput: '4',
});

const cloneDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneDeep(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = cloneDeep(val);
    }
    return out;
  }
  return value;
};

const mergeDeep = (base, override) => {
  if (override === null) {
    return null;
  }
  if (Array.isArray(override)) {
    return override.map((item) => cloneDeep(item));
  }
  if (typeof override !== 'object' || override === undefined) {
    return override !== undefined ? cloneDeep(override) : cloneDeep(base);
  }
  const baseObj =
    base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const result = { ...baseObj };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = mergeDeep(baseObj[key], value);
  }
  return result;
};

const createDefaultState = () => ({
  musicgen: {
    form: { ...DEFAULT_MUSICGEN_FORM },
    activeJobId: null,
    job: null,
    lastSummary: null,
  },
  loopMaker: {
    form: { ...DEFAULT_LOOPMAKER_FORM },
    activeJobId: null,
    job: null,
    lastSummary: null,
    statusMessage: '',
    errorMessage: '',
    lastJobId: null,
  },
  beatMaker: {
    form: { ...DEFAULT_BEATMAKER_FORM },
    activeJobId: null,
    job: null,
    lastSummary: null,
    status: '',
    error: '',
    lastJobId: null,
  },
});

const mergeStates = (defaults, stored) => {
  const base = cloneDeep(defaults);
  if (!stored || typeof stored !== 'object') {
    return base;
  }
  for (const [key, value] of Object.entries(stored)) {
    if (value === undefined) continue;
    base[key] = mergeDeep(base[key], value);
  }
  return base;
};

const SharedStateContext = createContext(null);

const safeIsTauri = () => {
  try {
    return isTauri();
  } catch (err) {
    console.warn('Unable to determine Tauri environment for shared state', err);
    return false;
  }
};

export function SharedStateProvider({ children }) {
  const defaultStateRef = useRef(createDefaultState());
  const [state, setState] = useState(() => cloneDeep(defaultStateRef.current));
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const storeRef = useRef(null);
  const useLocalRef = useRef(false);

  const persistState = useCallback(
    async (nextState) => {
      if (!readyRef.current) return;
      try {
        if (storeRef.current) {
          await storeRef.current.set(STORAGE_KEY, nextState);
          await storeRef.current.save();
        } else if (useLocalRef.current && typeof window !== 'undefined') {
          window.localStorage?.setItem(
            LOCAL_STORAGE_KEY,
            JSON.stringify(nextState)
          );
        }
      } catch (err) {
        console.warn('Failed to persist shared state', err);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const defaults = defaultStateRef.current;
      let next = cloneDeep(defaults);
      let store = null;
      const inTauri = safeIsTauri();
      if (inTauri) {
        try {
          store = await Store.load(STORAGE_FILE);
          storeRef.current = store;
          const stored = await store.get(STORAGE_KEY);
          if (stored && typeof stored === 'object') {
            next = mergeStates(defaults, stored);
          }
        } catch (err) {
          console.warn('Failed to load Tauri shared state store', err);
          store = null;
          storeRef.current = null;
        }
      }

      if (!store) {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            useLocalRef.current = true;
            const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
            if (raw) {
              try {
                const parsed = JSON.parse(raw);
                next = mergeStates(defaults, parsed);
              } catch (err) {
                console.warn('Failed to parse stored shared state JSON', err);
              }
            }
          }
        } catch (err) {
          console.warn('Failed to access localStorage for shared state', err);
          useLocalRef.current = false;
        }
      }

      if (!cancelled) {
        setState(next);
        readyRef.current = true;
        setReady(true);
      } else if (store) {
        try {
          await store.close();
        } catch (err) {
          console.warn('Failed to close shared state store', err);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      const store = storeRef.current;
      storeRef.current = null;
      if (store) {
        (async () => {
          try {
            await store.save();
            await store.close();
          } catch (err) {
            console.warn('Failed to close shared state store on cleanup', err);
          }
        })();
      }
    };
  }, []);

  const updateSection = useCallback(
    (section, updater) => {
      if (!section) return;
      setState((prev) => {
        const currentSection = prev[section] ?? {};
        const patch =
          typeof updater === 'function' ? updater(currentSection) : updater;
        if (!patch || typeof patch !== 'object') {
          return prev;
        }
        const nextSection = mergeDeep(currentSection, patch);
        const nextState = { ...prev, [section]: nextSection };
        void persistState(nextState);
        return nextState;
      });
    },
    [persistState]
  );

  const resetSection = useCallback(
    (section) => {
      if (!section) return;
      setState((prev) => {
        const defaults = defaultStateRef.current[section];
        const nextSection = cloneDeep(
          defaults !== undefined ? defaults : {}
        );
        const nextState = { ...prev, [section]: nextSection };
        void persistState(nextState);
        return nextState;
      });
    },
    [persistState]
  );

  const contextValue = useMemo(
    () => ({
      ready,
      state,
      updateSection,
      resetSection,
    }),
    [ready, state, updateSection, resetSection]
  );

  return (
    <SharedStateContext.Provider value={contextValue}>
      {children}
    </SharedStateContext.Provider>
  );
}

export function useSharedState() {
  const ctx = useContext(SharedStateContext);
  if (!ctx) {
    throw new Error('useSharedState must be used within a SharedStateProvider');
  }
  return ctx;
}
