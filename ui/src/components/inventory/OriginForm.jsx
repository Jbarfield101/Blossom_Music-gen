import React, { useEffect, useRef } from 'react';

export default function OriginForm({ origin, pending, onSubmit }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = origin || '';
    }
  }, [origin]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const value = textareaRef.current?.value ?? '';
    await onSubmit?.(value);
  };

  return (
    <section className="wi-panel">
      <div className="wi-panel-header">
        <h3>Origin</h3>
        <button type="button" onClick={handleSubmit} disabled={pending}>
          Save origin
        </button>
      </div>
      <textarea
        ref={textareaRef}
        defaultValue={origin || ''}
        placeholder="Recorded origin or acquisition notes"
        rows={3}
        disabled={pending}
      />
    </section>
  );
}
