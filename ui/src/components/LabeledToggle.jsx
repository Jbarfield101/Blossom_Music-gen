import PropTypes from 'prop-types';

export default function LabeledToggle({
  id,
  label,
  description,
  checked,
  disabled = false,
  onChange,
  style,
}) {
  const handleInputChange = (event) => {
    if (typeof onChange !== 'function') {
      return;
    }

    if (disabled) {
      event.preventDefault();
      return;
    }

    onChange(event.target.checked, event);
  };

  const trackStyle = {
    width: '2.75rem',
    height: '1.5rem',
    borderRadius: '999px',
    border: '1px solid color-mix(in srgb, var(--text) 24%, transparent)',
    background: checked
      ? 'var(--accent)'
      : 'color-mix(in srgb, var(--text) 18%, transparent)',
    transition: 'background 0.2s ease, border-color 0.2s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: checked ? 'flex-end' : 'flex-start',
    padding: '0 0.2rem',
    boxShadow: checked
      ? 'inset 0 0 0 1px color-mix(in srgb, var(--text) 15%, transparent)'
      : 'none',
    opacity: disabled ? 0.6 : 1,
  };

  const thumbStyle = {
    width: '1.15rem',
    height: '1.15rem',
    borderRadius: '50%',
    background: 'var(--card-bg)',
    transform: checked ? 'translateX(0.1rem)' : 'translateX(0)',
    transition: 'transform 0.2s ease',
    boxShadow: '0 2px 4px rgba(15, 23, 42, 0.2)',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1.25rem',
        ...style,
      }}
    >
      <div style={{ display: 'grid', gap: description ? '0.3rem' : 0 }}>
        <span id={`${id}-label`} style={{ fontWeight: 600, fontSize: '1rem' }}>
          {label}
        </span>
        {description ? (
          <span
            className="card-caption"
            style={{
              color: 'color-mix(in srgb, var(--text) 80%, transparent)',
              fontSize: '0.9rem',
              lineHeight: 1.4,
            }}
          >
            {description}
          </span>
        ) : null}
      </div>
      <label
        htmlFor={id}
        style={{
          position: 'relative',
          borderRadius: '999px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          checked={checked}
          onChange={handleInputChange}
          disabled={disabled}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            margin: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
        <span aria-hidden style={trackStyle}>
          <span style={thumbStyle} />
        </span>
      </label>
    </div>
  );
}

LabeledToggle.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  description: PropTypes.string,
  checked: PropTypes.bool,
  disabled: PropTypes.bool,
  onChange: PropTypes.func,
  style: PropTypes.object,
};

LabeledToggle.defaultProps = {
  description: undefined,
  checked: false,
  disabled: false,
  onChange: undefined,
  style: undefined,
};
