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
  const handleToggle = (event) => {
    if (typeof onChange !== 'function' || disabled) {
      return;
    }
    onChange(!checked, event);
  };

  const trackStyle = {
    width: '2.75rem',
    height: '1.5rem',
    borderRadius: '999px',
    border: '1px solid rgba(15, 23, 42, 0.2)',
    background: checked ? 'var(--accent)' : 'rgba(15, 23, 42, 0.1)',
    transition: 'background 0.2s ease, border-color 0.2s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: checked ? 'flex-end' : 'flex-start',
    padding: '0 0.2rem',
    boxShadow: checked ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.25)' : 'none',
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
              color: 'rgba(15, 23, 42, 0.68)',
              fontSize: '0.9rem',
              lineHeight: 1.4,
            }}
          >
            {description}
          </span>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        onClick={handleToggle}
        disabled={disabled}
        style={{
          position: 'relative',
          border: 'none',
          background: 'transparent',
          padding: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '1.5rem',
          borderRadius: '999px',
          outlineOffset: '3px',
        }}
      >
        <span aria-hidden style={trackStyle}>
          <span style={thumbStyle} />
        </span>
      </button>
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
