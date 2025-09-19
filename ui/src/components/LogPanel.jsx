import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

export default function LogPanel() {
  const [lines, setLines] = useState([]);
  const containerRef = useRef(null);
  const pendingRef = useRef([]);
  const flushTimerRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    const flush = () => {
      flushTimerRef.current = null;
      const pending = pendingRef.current;
      if (!pending.length) return;
      pendingRef.current = [];
      setLines((prev) => {
        const merged = prev.concat(pending);
        const limit = 300;
        return merged.length > limit ? merged.slice(merged.length - limit) : merged;
      });
    };
    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(flush, 80);
    };
    const unlistenPromise = listen("logs::line", (event) => {
      pendingRef.current.push(String(event.payload ?? ""));
      scheduleFlush();
    });
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      unlistenPromise.then((un) => un());
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Maintain autoscroll only when user is near the bottom
    if (autoScrollRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [lines]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 8;
    autoScrollRef.current = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold;
  };

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{
        backgroundColor: "var(--log-bg)",
        color: "var(--log-fg)",
        padding: "0.5rem",
        maxHeight: "200px",
        overflowY: "auto",
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        lineHeight: 1.25,
      }}
    >
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{lines.join("\n")}</pre>
    </div>
  );
}

