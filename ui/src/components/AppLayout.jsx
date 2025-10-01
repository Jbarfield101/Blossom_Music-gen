import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import MainNav from './MainNav.jsx';

const DESKTOP_QUERY = '(min-width: 960px)';

function getIsDesktop() {
  return typeof window !== 'undefined'
    ? window.matchMedia(DESKTOP_QUERY).matches
    : false;
}

export default function AppLayout() {
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const showNav = normalizedPath !== '/';
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [isNavOpen, setIsNavOpen] = useState(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('navOpen') : null;
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return showNav && getIsDesktop();
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(DESKTOP_QUERY);

    const handleChange = (event) => {
      setIsDesktop(event.matches);
    };

    handleChange(mediaQuery);
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!showNav) {
      setIsNavOpen(false);
    }
  }, [showNav]);

  useEffect(() => {
    if (!isDesktop) {
      setIsNavOpen(false);
    }
  }, [location.pathname, isDesktop]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('navOpen', String(isNavOpen));
    }
  }, [isNavOpen]);

  const closeNav = () => {
    setIsNavOpen(false);
  };
  const toggleNav = () => {
    setIsNavOpen((prev) => !prev);
  };

  const navId = 'main-navigation';
  const navOpenAttribute = showNav && isNavOpen ? 'true' : 'false';

  return (
    <div className="app-layout" data-nav-open={navOpenAttribute}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {showNav && (
        <button
          type="button"
          className="app-layout__nav-toggle"
          aria-controls={navId}
          aria-expanded={isNavOpen}
          onClick={toggleNav}
        >
          Menu
        </button>
      )}
      {showNav && (
        <MainNav isOpen={isNavOpen} onNavigate={closeNav} navId={navId} />
      )}
      {showNav && (
        <div className="app-layout__scrim" aria-hidden="true" onClick={closeNav} />
      )}
      <main id="main-content" className="app-layout__content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
