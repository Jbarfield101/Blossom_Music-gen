import { useMemo } from 'react';

function clampNumber(value, minimum, maximum) {
  const num = Number(value);
  if (!Number.isFinite(num)) return minimum;
  if (num < minimum) return minimum;
  if (num > maximum) return maximum;
  return num;
}

function DualRangeSlider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  disabled = false,
  className = '',
  ...rest
}) {
  const [currentMin, currentMax] = useMemo(() => {
    if (!Array.isArray(value) || value.length < 2) {
      return [min, max];
    }

    const rawMin = clampNumber(value[0], min, max);
    const rawMax = clampNumber(value[1], min, max);
    const safeMin = Math.min(rawMin, rawMax);
    const safeMax = Math.max(rawMin, rawMax);

    return [safeMin, safeMax];
  }, [value, min, max]);

  const handleMinChange = (event) => {
    if (typeof onChange !== 'function') return;

    const nextMin = clampNumber(event.target.value, min, currentMax);
    onChange([Math.min(nextMin, currentMax), currentMax]);
  };

  const handleMaxChange = (event) => {
    if (typeof onChange !== 'function') return;

    const nextMax = clampNumber(event.target.value, currentMin, max);
    onChange([currentMin, Math.max(nextMax, currentMin)]);
  };

  const range = Math.max(max - min, 1);
  const startPercent = ((currentMin - min) / range) * 100;
  const endPercent = ((currentMax - min) / range) * 100;

  const sliderClassName = ['dual-range-slider', className, disabled ? 'is-disabled' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={sliderClassName}
      data-start={startPercent}
      data-end={endPercent}
      aria-disabled={disabled}
      {...rest}
    >
      <div
        className="dual-range-track"
        style={{
          '--range-start': `${startPercent}%`,
          '--range-end': `${endPercent}%`,
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentMin}
        onChange={handleMinChange}
        disabled={disabled}
        aria-label="Minimum value"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentMax}
        onChange={handleMaxChange}
        disabled={disabled}
        aria-label="Maximum value"
      />
    </div>
  );
}

export default DualRangeSlider;
