import { useEffect, useState } from "react";
import { listModels } from "../api/models.js";
import BackButton from "../components/BackButton.jsx";

export default function Models() {
  const [models, setModels] = useState([]);

  useEffect(() => {
    listModels()
      .then(setModels)
      .catch((e) => console.error(e));
  }, []);

  return (
    <div className="p-md">
      <BackButton />
      <h1 className="mb-md">Available Models</h1>
      <ul>
        {models.map((name) => (
          <li key={name} className="mb-sm">
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

