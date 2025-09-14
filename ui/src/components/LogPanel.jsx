import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

export default function LogPanel() {
  const [lines, setLines] = useState([]);
  const endRef = useRef(null);

  useEffect(() => {
    const unlisten = listen("logs::line", (event) => {
      setLines((prev) => [...prev, event.payload]);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      style={{
        backgroundColor: "#000",
        color: "#0f0",
        padding: "0.5rem",
        maxHeight: "200px",
        overflowY: "auto",
        fontFamily: "monospace",
      }}
    >
      {lines.map((line, idx) => (
        <div key={idx}>{line}</div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

