import { Outlet } from 'react-router-dom';
import MainNav from './MainNav.jsx';

export default function AppLayout() {
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <MainNav />
      <main id="main-content" className="app-layout__content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
