import React, { useEffect, useRef } from 'react';

function parseNumber(value) {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? 0 : numeric;
}

export default function DurabilityForm({ values, pending, onSubmit }) {
  const currentRef = useRef(null);
  const maximumRef = useRef(null);
  const stateRef = useRef(null);
  const notesRef = useRef(null);

  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.value = values?.current ?? 0;
    }
    if (maximumRef.current) {
      maximumRef.current.value = values?.maximum ?? 0;
    }
    if (stateRef.current) {
      stateRef.current.value = values?.state ?? '';
    }
    if (notesRef.current) {
      notesRef.current.value = values?.notes ?? '';
    }
  }, [values?.current, values?.maximum, values?.state, values?.notes]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const next = {
      current: parseNumber(currentRef.current?.value ?? 0),
      maximum: parseNumber(maximumRef.current?.value ?? 0),
      state: stateRef.current?.value ?? '',
      notes: notesRef.current?.value ?? '',
    };
    await onSubmit?.(next);
  };

  return (
    <form className="wi-panel" onSubmit={handleSubmit}>
      <div className="wi-panel-header">
        <h3>Durability</h3>
        <button type="submit" disabled={pending}>
          Update
        </button>
      </div>
      <label>
        <span>Current</span>
        <input
          ref={currentRef}
          type="number"
          min="0"
          name="current"
          defaultValue={values?.current ?? 0}
          disabled={pending}
        />
      </label>
      <label>
        <span>Maximum</span>
        <input
          ref={maximumRef}
          type="number"
          min="0"
          name="maximum"
          defaultValue={values?.maximum ?? 0}
          disabled={pending}
        />
      </label>
      <label>
        <span>Status</span>
        <input
          ref={stateRef}
          type="text"
          name="state"
          defaultValue={values?.state ?? ''}
          disabled={pending}
        />
      </label>
      <label>
        <span>Notes</span>
        <textarea
          ref={notesRef}
          name="notes"
          rows={3}
          defaultValue={values?.notes ?? ''}
          disabled={pending}
        />
      </label>
    </form>
  );
}
