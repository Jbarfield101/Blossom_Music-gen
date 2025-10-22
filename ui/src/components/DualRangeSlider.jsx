import { useMemo, useState } from 'react';

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
  value = [min, max],
  onChange,
  disabled = false,
  className = '',
}) {
  const [activeThumb, setActiveThumb] = useState(null);

  const [normalizedMin, normalizedMax] = useMemo(() => {
    const rangeMin = clampNumber(Array.isArray(value) ? value[0] : min, min, max);
    const rangeMax = clampNumber(Array.isArray(value) ? value[1] : max, min, max);
    if (rangeMin > rangeMax) {
      return [rangeMax, rangeMin];
    }
    return [rangeMin, rangeMax];
  }, [value, min, max]);

  const percentRange = max - min <= 0 ? [0, 100] : [
    ((normalizedMin - min) / (max - min)) * 100,
    ((normalizedMax - min) / (max - min)) * 100,
  ];

  const handleMinChange = (event) => {
    const nextValue = clampNumber(event.target.value, min, max);
    const boundedValue = Math.min(nextValue, normalizedMax);
    if (typeof onChange === 'function') {
      onChange([boundedValue, Math.max(boundedValue, normalizedMax)]);
    }
  };

  const handleMaxChange = (event) => {
    const nextValue = clampNumber(event.target.value, min, max);
    const boundedValue = Math.max(nextValue, normalizedMin);
    if (typeof onChange === 'function') {
      onChange([Math.min(normalizedMin, boundedValue), boundedValue]);
    }
  };

  const handlePointerDown = (thumb) => () => {
    setActiveThumb(thumb);
  };

  const handlePointerUp = () => {
    setActiveThumb(null);
  };

  const sliderClassName = [
    'dual-range-slider',
    disabled ? 'is-disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  const sliderStyle = {
    '--dual-range-min': `${percentRange[0]}%`,
    '--dual-range-max': `${percentRange[1]}%`,
  };

  const minZIndex = activeThumb === 'min' ? 4 : 3;
  const maxZIndex = activeThumb === 'max' ? 4 : 2;

  return (
    <div className={sliderClassName} style={sliderStyle}>
      <div className="dual-range-slider__track" aria-hidden="true" />
      <input
        type="range"
        className="dual-range-slider__input dual-range-slider__input--min"
        min={min}
        max={max}
        step={step}
        value={normalizedMin}
        onChange={handleMinChange}
        onPointerDown={handlePointerDown('min')}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onBlur={handlePointerUp}
        disabled={disabled}
        style={{ zIndex: minZIndex }}
      />
      <input
        type="range"
        className="dual-range-slider__input dual-range-slider__input--max"
        min={min}
        max={max}
        step={step}
        value={normalizedMax}
        onChange={handleMaxChange}
        onPointerDown={handlePointerDown('max')}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onBlur={handlePointerUp}
        disabled={disabled}
        style={{ zIndex: maxZIndex }}
      />
    </div>
  );
}

export default DualRangeSlider;
