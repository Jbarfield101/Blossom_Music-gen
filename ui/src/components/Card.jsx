import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';

export default function Card({ to, icon, title, children, onClick, disabled = false }) {
  const content = (
    <>
      {icon && (
        <Icon
          name={icon}
          size={48}
          className="card-icon"
          aria-hidden="true"
        />
      )}
      <h2>{title}</h2>
      {children && <p className="card-caption">{children}</p>}
    </>
  );

  if (to) {
    return (
      <NavLink
        to={to}
        className={({ isActive }) => `card${isActive ? ' active' : ''}`}
        onClick={onClick}
      >
        {content}
      </NavLink>
    );
  }

  const className = `card${disabled ? ' is-disabled' : ''}`;
  return (
    <button
      type="button"
      className={className}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {content}
    </button>
  );
}
