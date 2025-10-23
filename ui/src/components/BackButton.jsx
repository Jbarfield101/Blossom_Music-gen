import { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavContext } from './AppLayout.jsx';

export default function BackButton({ to = null, label = 'Back' }) {
  const navigate = useNavigate();
  const { showNav, setBackLink } = useContext(NavContext);

  useEffect(() => {
    if (typeof setBackLink !== 'function' || !showNav) {
      return undefined;
    }

    const linkConfig = { label, to };
    setBackLink(linkConfig);

    return () => {
      setBackLink(null);
    };
  }, [setBackLink, showNav, label, to]);

  const handleBack = () => {
    if (to) {
      navigate(to);
      return;
    }
    navigate(-1);
  };

  if (showNav) {
    return null;
  }

  return (
    <button type="button" className="back-button" onClick={handleBack}>
      {label}
    </button>
  );
}
