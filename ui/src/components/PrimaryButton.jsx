import PropTypes from "prop-types";
import "./PrimaryButton.css";

export default function PrimaryButton({
  children,
  className = "",
  loading = false,
  loadingText,
  disabled = false,
  ...props
}) {
  const isDisabled = disabled || loading;
  const classes = ["primary-button", loading ? "is-loading" : "", className]
    .filter(Boolean)
    .join(" ");
  const content = loading && loadingText ? loadingText : children;

  return (
    <button
      {...props}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading ? "true" : undefined}
      data-loading={loading ? "true" : undefined}
    >
      {loading && (
        <span className="spinner primary-button__spinner" aria-hidden="true" />
      )}
      <span className="primary-button__label">{content}</span>
    </button>
  );
}

PrimaryButton.propTypes = {
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
  loading: PropTypes.bool,
  loadingText: PropTypes.node,
  disabled: PropTypes.bool,
};
