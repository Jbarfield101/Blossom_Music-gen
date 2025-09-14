import { useEffect, useState } from "react";

export default function Models() {
  const [models, setModels] = useState([]);

  useEffect(() => {
    fetch("/models", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((data) => setModels(data))
      .catch((e) => console.error(e));
  }, []);

  return (
    <div className="p-md">
      <h1>Available Models</h1>
      <ul>
        {models.map((m) => (
          <li key={m.name}>
            <a href={m.url}>{m.name}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

