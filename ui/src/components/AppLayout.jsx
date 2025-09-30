import { Outlet, useLocation } from 'react-router-dom';
import MainNav from './MainNav.jsx';

export default function AppLayout() {
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const showNav = normalizedPath !== '/';

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {showNav && <MainNav />}
      <main id="main-content" className="app-layout__content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
