import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/musicgen', label: 'Sound Lab' },
  { to: '/dnd', label: 'D&D' },
  { to: '/dnd/dungeon-master', label: 'Dungeon Master Dashboard' },
  { to: '/games', label: 'Games' },
  { to: '/tools', label: 'Tools' },
  { to: '/visual-generator', label: 'Visual Generator' },
  { to: '/queue', label: 'Queue' },
  { to: '/settings', label: 'Settings' },
];

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export default function MainNav({ isOpen, onNavigate, navId = 'main-navigation' }) {
  const handleNavigate = () => {
    if (typeof onNavigate === 'function') {
      onNavigate();
    }
  };

  return (
    <nav
      id={navId}
      className={classNames('main-nav', isOpen && 'is-open')}
      aria-label="Primary"
    >
      <button
        type="button"
        className="main-nav__close"
        aria-label="Close navigation"
        onClick={handleNavigate}
      >
        Close
      </button>
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
              onClick={handleNavigate}
            >
              <span className="main-nav__text">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
