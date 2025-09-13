import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export default function LogPanel() {
  const [lines, setLines] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    let unlisten;
    listen("logs::line", (event) => {
      const line = typeof event.payload === "string" ? event.payload : String(event.payload);
      setLines((prev) => [...prev, line]);
    }).then((f) => {
      unlisten = f;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      style={{
        backgroundColor: "#111",
        color: "#0f0",
        fontFamily: "monospace",
        padding: "0.5rem",
        maxHeight: "200px",
        overflowY: "auto",
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
