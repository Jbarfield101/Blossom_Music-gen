import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useJobQueue(pollInterval = 2000) {
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke("list_job_queue");
      if (Array.isArray(result)) {
        setQueue(result);
      } else {
        setQueue([]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    if (pollInterval > 0) {
      const handle = setInterval(refresh, pollInterval);
      return () => clearInterval(handle);
    }
    return undefined;
  }, [refresh, pollInterval]);

  return { queue, error, refresh };
}
