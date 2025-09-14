import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';

export default function Card({ to, icon, title, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `card${isActive ? ' active' : ''}`}
    >
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
    </NavLink>
  );
}
