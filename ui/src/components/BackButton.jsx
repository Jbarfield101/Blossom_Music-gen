import { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavContext } from './AppLayout.jsx';

export default function BackButton({ to = null, label = 'Back' }) {
  const navigate = useNavigate();
  const { toggleNav, isNavOpen, showNav, navId, registerNavAnchor } = useContext(NavContext);

  useEffect(() => {
    if (typeof registerNavAnchor !== 'function' || !showNav) {
      return undefined;
    }
    return registerNavAnchor();
  }, [registerNavAnchor, showNav]);

  const handleBack = () => {
    if (to) {
      navigate(to);
      return;
    }
    navigate(-1);
  };

  return (
    <div className="back-button-group">
      <button type="button" className="back-button" onClick={handleBack}>
        {label}
      </button>
      {showNav && typeof toggleNav === 'function' && (
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
    </div>
  );
}
