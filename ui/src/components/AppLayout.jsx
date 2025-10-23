import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import MainNav from './MainNav.jsx';
import CommandPalette from './CommandPalette.jsx';

const DESKTOP_QUERY = '(min-width: 960px)';

export const NavContext = createContext({
  toggleNav: undefined,
  closeNav: undefined,
  isNavOpen: false,
  showNav: false,
  navId: '',
  registerNavAnchor: undefined,
});

function getIsDesktop() {
  return typeof window !== 'undefined'
    ? window.matchMedia(DESKTOP_QUERY).matches
    : false;
}

export default function AppLayout({ greetingPlayback = null }) {
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
  const [navAnchorCount, setNavAnchorCount] = useState(0);

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

  const closeNav = useCallback(() => {
    setIsNavOpen(false);
  }, []);
  const toggleNav = useCallback(() => {
    setIsNavOpen((prev) => !prev);
  }, []);
  const registerNavAnchor = useCallback(() => {
    setNavAnchorCount((count) => count + 1);
    return () => {
      setNavAnchorCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const navId = 'main-navigation';
  const navOpenAttribute = showNav && isNavOpen ? 'true' : 'false';
  const shouldShowStandaloneToggle = showNav && navAnchorCount === 0;

  const greetingAudioRef = useRef(null);
  const isPlayingGreetingRef = useRef(false);
  const [shouldShowGreetingPrompt, setShouldShowGreetingPrompt] = useState(false);
  const [localGreetingError, setLocalGreetingError] = useState('');

  const greetingAudio = greetingPlayback ? greetingPlayback.audio : null;
  const greetingEnabled = Boolean(greetingPlayback && (greetingPlayback.enabled || greetingPlayback.ready));
  const remoteGreetingError = greetingEnabled && greetingPlayback && greetingPlayback.error ? greetingPlayback.error : '';
  const isGreetingReady = Boolean(
    greetingPlayback &&
      greetingPlayback.ready &&
      typeof Audio !== 'undefined' &&
      greetingAudio instanceof Audio,
  );

  useEffect(() => {
    if (isGreetingReady) {
      if (greetingAudioRef.current !== greetingAudio) {
        greetingAudioRef.current = greetingAudio;
        setShouldShowGreetingPrompt(true);
        setLocalGreetingError('');
      }
    } else {
      greetingAudioRef.current = null;
      setShouldShowGreetingPrompt(false);
    }
  }, [isGreetingReady, greetingAudio]);

  const playGreeting = useCallback(() => {
    const audioElement = greetingAudioRef.current;
    if (!audioElement) {
      setLocalGreetingError('Greeting audio is unavailable.');
      return;
    }
    if (isPlayingGreetingRef.current) {
      return;
    }
    isPlayingGreetingRef.current = true;
    try {
      audioElement.currentTime = 0;
    } catch (error) {
      console.warn('Failed to reset greeting audio', error);
    }
    const playPromise = audioElement.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          isPlayingGreetingRef.current = false;
          setShouldShowGreetingPrompt(false);
          setLocalGreetingError('');
        })
        .catch((error) => {
          isPlayingGreetingRef.current = false;
          console.warn('Failed to play greeting audio', error);
          setLocalGreetingError('Unable to play greeting audio. Tap to retry.');
          setShouldShowGreetingPrompt(true);
        });
    } else {
      isPlayingGreetingRef.current = false;
      setShouldShowGreetingPrompt(false);
      setLocalGreetingError('');
    }
  }, []);

  useEffect(() => {
    if (!shouldShowGreetingPrompt) {
      return undefined;
    }
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleFirstInteraction = () => {
      playGreeting();
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    return () => window.removeEventListener('pointerdown', handleFirstInteraction);
  }, [shouldShowGreetingPrompt, playGreeting]);

  const shouldDisplayGreetingToast = shouldShowGreetingPrompt || (greetingEnabled && (remoteGreetingError || localGreetingError));

  const navContextValue = useMemo(
    () => ({
      toggleNav,
      closeNav,
      isNavOpen,
      showNav,
      navId,
      registerNavAnchor,
    }),
    [toggleNav, closeNav, isNavOpen, showNav, navId, registerNavAnchor],
  );

  return (
    <NavContext.Provider value={navContextValue}>
      <div className="app-layout" data-nav-open={navOpenAttribute}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {shouldShowStandaloneToggle && (
          <div className="app-layout__nav-toggle-wrapper">
            <button
              type="button"
              className="app-layout__nav-toggle"
              aria-controls={navId}
              aria-expanded={isNavOpen}
              onClick={toggleNav}
            >
              Menu
            </button>
          </div>
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
        {shouldDisplayGreetingToast && (
          <div
            className="app-layout__greeting-toast"
            role={shouldShowGreetingPrompt ? 'dialog' : 'alert'}
            aria-live="polite"
            style={{
              position: 'fixed',
              right: '1.5rem',
              bottom: '1.5rem',
              background: 'rgba(24, 24, 24, 0.92)',
              color: 'var(--text, #fff)',
              borderRadius: '0.75rem',
              padding: '1rem',
              boxShadow: '0 0.5rem 1.5rem rgba(0, 0, 0, 0.25)',
              width: 'min(320px, calc(100vw - 3rem))',
              zIndex: 1000,
              display: 'grid',
              gap: '0.5rem',
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {shouldShowGreetingPrompt ? 'Greeting ready' : 'Greeting unavailable'}
            </div>
            {shouldShowGreetingPrompt && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  playGreeting();
                }}
                style={{
                  borderRadius: '999px',
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.9rem',
                  background: 'var(--accent, #7c5cff)',
                  color: 'var(--on-accent, #fff)',
                  border: 'none',
                  cursor: 'pointer',
                  justifySelf: 'start',
                }}
              >
                Play greeting
              </button>
            )}
            {(localGreetingError || remoteGreetingError) && (
              <div style={{ fontSize: '0.85rem', opacity: 0.85 }}>
                {localGreetingError || remoteGreetingError}
              </div>
            )}
          </div>
        )}
        <CommandPalette />
      </div>
    </NavContext.Provider>
  );
}
