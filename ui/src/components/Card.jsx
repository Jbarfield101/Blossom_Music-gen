import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

export default function Card({ to, icon, title, children }) {
  return (
    <Link className="card" to={to}>
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
    </Link>
  );
}
