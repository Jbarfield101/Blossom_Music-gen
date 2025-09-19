function formatSeconds(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}`;
}

export default function JobQueuePanel({ queue, onCancel, activeId }) {
  if (!Array.isArray(queue) || queue.length === 0) {
    return null;
  }

  const handleCancel = (id) => {
    if (typeof onCancel === "function") {
      onCancel(id);
    }
  };

  return (
    <section className="job-queue">
      <h2>Job Queue</h2>
      <table className="job-queue-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Position</th>
            <th>Label</th>
            <th>ETA</th>
            <th>Queued</th>
            <th>Started</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((item) => {
            const isActive = activeId && item.id === activeId;
            const canCancel = ["queued", "running"].includes(
              item.status || ""
            );
            const position =
              typeof item.position === "number"
                ? item.position + 1
                : "—";
            return (
              <tr key={item.id} className={isActive ? "job-active" : undefined}>
                <td>{item.status}</td>
                <td>{position}</td>
                <td>{item.label || item.kind || item.id}</td>
                <td>
                  {typeof item.eta_seconds === "number"
                    ? formatSeconds(item.eta_seconds)
                    : "—"}
                </td>
                <td>{item.queued_at || "—"}</td>
                <td>{item.started_at || "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleCancel(item.id)}
                    disabled={!canCancel || typeof onCancel !== "function"}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

JobQueuePanel.defaultProps = {
  queue: [],
  onCancel: undefined,
  activeId: undefined,
};
