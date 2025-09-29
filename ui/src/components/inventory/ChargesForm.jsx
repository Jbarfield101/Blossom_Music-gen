import React, { useEffect, useRef } from 'react';

function parseNumber(value) {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? 0 : numeric;
}

export default function ChargesForm({ values, pending, onSubmit }) {
  const currentRef = useRef(null);
  const maximumRef = useRef(null);
  const rechargeRef = useRef(null);

  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.value = values?.current ?? 0;
    }
    if (maximumRef.current) {
      maximumRef.current.value = values?.maximum ?? 0;
    }
    if (rechargeRef.current) {
      rechargeRef.current.value = values?.recharge ?? '';
    }
  }, [values?.current, values?.maximum, values?.recharge]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const next = {
      current: parseNumber(currentRef.current?.value ?? 0),
      maximum: parseNumber(maximumRef.current?.value ?? 0),
      recharge: rechargeRef.current?.value ?? '',
    };
    await onSubmit?.(next);
  };

  return (
    <form className="wi-panel" onSubmit={handleSubmit}>
      <div className="wi-panel-header">
        <h3>Charges</h3>
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
        <span>Recharge</span>
        <input
          ref={rechargeRef}
          type="text"
          name="recharge"
          defaultValue={values?.recharge ?? ''}
          disabled={pending}
        />
      </label>
    </form>
  );
}
