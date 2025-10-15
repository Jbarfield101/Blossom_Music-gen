import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';

/**
 * Vertical feature wheel of floating icons.
 * - Mouse wheel and ArrowUp/ArrowDown to navigate
 * - Enter/Click to open the selected route
 */
export default function FeatureWheel({ items, initialIndex = 0, radius = 80, spacing = 88 }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(initialIndex);
  const containerRef = useRef(null);
  const lockRef = useRef(false);
  const [measuredSpacing, setMeasuredSpacing] = useState(null);

  const clampedIndex = (i) => {
    const n = items.length;
    return ((i % n) + n) % n;
  };

  const handleStep = (delta) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setIndex((i) => clampedIndex(i + delta));
    // simple lock to prevent overscrolling
    setTimeout(() => (lockRef.current = false), 120);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 : -1;
    handleStep(delta);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Dynamically compute spacing to fill most of the column
  useEffect(() => {
    const el = containerRef.current;
    if (!el || items.length === 0) return;
    const compute = () => {
      const h = el.getBoundingClientRect().height || 0;
      const gaps = Math.max(1, items.length - 1);
      const s = Math.max(72, (h * 0.75) / gaps); // fill ~75% of height
      setMeasuredSpacing(s);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleStep(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleStep(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = items[index];
        if (sel) navigate(sel.to);
      }
    };
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [index, items, navigate]);

  const positions = useMemo(() => {
    const effSpacing = measuredSpacing ?? spacing;
    const n = items.length;
    return items.map((_, i) => {
      // relative offset from active index, wrapped to shortest distance
      let d = i - index;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;

      const y = d * effSpacing;
      const depth = 1 - Math.min(Math.abs(d) * 0.15, 0.7);
      const scale = 0.8 + depth * 0.4; // 0.8..1.2
      const opacity = 0.35 + depth * 0.65; // 0.35..1
      const z = Math.round(depth * 1000);
      return { y, scale, opacity, z, d };
    });
  }, [items, index, spacing, measuredSpacing]);

  return (
    <div
      ref={containerRef}
      className="feature-wheel"
      role="listbox"
      aria-activedescendant={`feature-${index}`}
      tabIndex={0}
    >
      {items.map((item, i) => {
        const { y, scale, opacity, z, d } = positions[i];
        const selected = clampedIndex(index) === i;
        return (
          <button
            key={item.to}
            id={`feature-${i}`}
            role="option"
            aria-selected={selected}
            className={`feature-wheel-item${selected ? ' selected' : ''}`}
            style={{
              transform: `translate(0, ${y}px) scale(${scale})`,
              opacity,
              zIndex: z,
            }}
            onClick={() => navigate(item.to)}
          >
            <span className="sr-only">{item.title}</span>
            <Icon name={item.icon} size={48} className="feature-wheel-icon" />
            {selected && (
              <span className="feature-wheel-label" aria-hidden="true">
                {item.title}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
