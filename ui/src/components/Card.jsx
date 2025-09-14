import { Link } from 'react-router-dom';

export default function Card({ to, icon: Icon, title, children }) {
  return (
    <Link className="card" to={to}>
      {Icon && <Icon className="card-icon" size={48} aria-hidden="true" />}
      <h2>{title}</h2>
      {children && <p className="card-caption">{children}</p>}
    </Link>
  );
}
