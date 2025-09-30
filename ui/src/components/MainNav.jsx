import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/musicgen', label: 'Sound Lab' },
  { to: '/dnd', label: 'D&D' },
  { to: '/games', label: 'Games' },
  { to: '/tools', label: 'Tools' },
  { to: '/queue', label: 'Queue' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/train', label: 'Training' },
  { to: '/settings', label: 'Settings' },
];

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export default function MainNav() {
  return (
    <nav className="main-nav" aria-label="Primary">
      <div className="main-nav__brand" aria-hidden="true">
        Blossom
      </div>
      <ul className="main-nav__list">
        {links.map(({ to, label, end }) => (
          <li key={to} className="main-nav__item">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                classNames('main-nav__link', isActive && 'is-active')
              }
            >
              <span className="main-nav__text">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
