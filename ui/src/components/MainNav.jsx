import { NavLink, useNavigate } from 'react-router-dom';
import useHardwareInfo from '../lib/useHardwareInfo.js';
import useSystemMetrics from '../lib/useSystemMetrics.js';

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

function formatPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  const clamped = Math.min(Math.max(value, 0), 100);
  return `${Math.round(clamped)}%`;
}

export default function MainNav({ isOpen, onNavigate, navId = 'main-navigation', backLink = null }) {
  const navigate = useNavigate();
  const hardware = useHardwareInfo();
  const metrics = useSystemMetrics(2500);

  const handleNavigate = () => {
    if (typeof onNavigate === 'function') {
      onNavigate();
    }
  };

  const handleBack = () => {
    if (!backLink) {
      return;
    }

    if (backLink.to) {
      navigate(backLink.to);
    } else {
      navigate(-1);
    }

    handleNavigate();
  };

  const shouldShowBack = Boolean(backLink);

  const backLabel = backLink && backLink.label ? backLink.label : 'Back';

  const usageRows =
    metrics.status === 'ready' && metrics.snapshot
      ? [
          metrics.snapshot.cpu?.percent != null && {
            label: 'CPU',
            value: formatPercent(metrics.snapshot.cpu.percent),
          },
          metrics.snapshot.gpu?.percent != null && {
            label: 'GPU',
            value: formatPercent(metrics.snapshot.gpu.percent),
          },
          metrics.snapshot.memory?.percent != null && {
            label: 'RAM',
            value: formatPercent(metrics.snapshot.memory.percent),
          },
        ].filter(Boolean)
      : [];

  let usageNote = '';
  if (!usageRows.length) {
    if (metrics.status === 'unsupported') {
      usageNote = 'Launch the desktop app to see live usage.';
    } else if (metrics.status === 'error') {
      usageNote = metrics.error || 'Usage data unavailable.';
    } else {
      usageNote = 'Sampling live usage...';
    }
  }

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
        {shouldShowBack && (
          <li className="main-nav__item">
            <button
              type="button"
              className={classNames('main-nav__link', 'main-nav__link--back')}
              onClick={handleBack}
            >
              <span aria-hidden="true" className="main-nav__back-icon">
                ←
              </span>
              <span className="main-nav__text">{backLabel}</span>
            </button>
          </li>
        )}
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
        <li className="main-nav__item main-nav__item--hardware" aria-live="polite">
          <div className="main-nav__hardware">
            <p className="main-nav__hardware-heading">System specs</p>
            {usageRows.length ? (
              <dl className="main-nav__hardware-list">
                {usageRows.map(({ label, value }) => (
                  <div key={label} className="main-nav__hardware-row">
                    <dt className="main-nav__hardware-term">{label}</dt>
                    <dd className="main-nav__hardware-description">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : hardware.status === 'ready' && hardware.info ? (
              <dl className="main-nav__hardware-list">
                {[
                  { label: 'CPU', value: hardware.info.cpu },
                  { label: 'GPU', value: hardware.info.gpu },
                  { label: 'RAM', value: hardware.info.ram },
                  { label: 'OS', value: hardware.info.os },
                ].map(({ label, value }) => (
                  <div key={label} className="main-nav__hardware-row">
                    <dt className="main-nav__hardware-term">{label}</dt>
                    <dd className="main-nav__hardware-description">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="main-nav__hardware-note">
                {usageNote ||
                  (hardware.status === 'error'
                    ? 'Hardware info unavailable'
                    : hardware.status === 'unsupported'
                      ? 'Hardware info available in the desktop app'
                      : 'Detecting hardware.'
                  )}
              </p>
            )}
          </div>
        </li>
      </ul>
    </nav>
  );
}
