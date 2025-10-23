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
  setBackLink: undefined,
  backLink: null,
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
  const isDashboardRoute = normalizedPath === '/';
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const hasWindow = typeof window !== 'undefined';
  const initialManualClose = hasWindow ? window.localStorage.getItem('navManualClose') === 'true' : false;
  const manualCloseTimestampRef = useRef(initialManualClose ? Date.now() : 0);
  const manualOpenTimestampRef = useRef(0);
  const lastShowNavRef = useRef(showNav);
  const prevIsDesktopRef = useRef(isDesktop);
  const [isNavOpen, setIsNavOpen] = useState(() => {
    if (initialManualClose) return false;
    return showNav && getIsDesktop();
  });
  const [navAnchorCount, setNavAnchorCount] = useState(0);
  const [backLink, setBackLink] = useState(null);

  const recordManualClose = useCallback(() => {
    manualCloseTimestampRef.current = Date.now();
    manualOpenTimestampRef.current = 0;
    if (hasWindow) {
      window.localStorage.setItem('navManualClose', 'true');
    }
  }, [hasWindow]);

  const recordManualOpen = useCallback(() => {
    manualOpenTimestampRef.current = Date.now();
    manualCloseTimestampRef.current = 0;
    if (hasWindow) {
      window.localStorage.removeItem('navManualClose');
    }
  }, [hasWindow]);

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
    const wasShowingNav = lastShowNavRef.current;
    if (!wasShowingNav && showNav) {
      const lastManualClose = manualCloseTimestampRef.current;
      const lastManualOpen = manualOpenTimestampRef.current;
      const manualCloseStillActive = lastManualClose && (!lastManualOpen || lastManualClose > lastManualOpen);
      if (!manualCloseStillActive) {
        setIsNavOpen(true);
      }
    } else if (wasShowingNav && !showNav) {
      setIsNavOpen(false);
      if (isDashboardRoute && hasWindow) {
        window.localStorage.removeItem('navManualClose');
      }
      if (isDashboardRoute) {
        manualCloseTimestampRef.current = 0;
        manualOpenTimestampRef.current = 0;
      }
    }
    lastShowNavRef.current = showNav;
  }, [showNav, isDashboardRoute, hasWindow]);

  useEffect(() => {
    const wasDesktop = prevIsDesktopRef.current;
    if (wasDesktop && !isDesktop) {
      setIsNavOpen(false);
    }
    prevIsDesktopRef.current = isDesktop;
  }, [isDesktop]);

  const closeNav = useCallback(() => {
    setIsNavOpen((prev) => {
      if (prev) {
        recordManualClose();
      }
      return false;
    });
  }, [recordManualClose]);
  const toggleNav = useCallback(() => {
    setIsNavOpen((prev) => {
      const next = !prev;
      if (next) {
        recordManualOpen();
      } else {
        recordManualClose();
      }
      return next;
    });
  }, [recordManualClose, recordManualOpen]);
  const registerNavAnchor = useCallback(() => {
    setNavAnchorCount((count) => count + 1);
    return () => {
      setNavAnchorCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const updateBackLink = useCallback((link) => {
    setBackLink(link);
  }, []);

  const navId = 'main-navigation';
  const navOpenAttribute = showNav && isNavOpen ? 'true' : 'false';
  const shouldShowStandaloneToggle = showNav && navAnchorCount === 0;

  const greetingAudioRef = useRef(null);
  const isPlayingGreetingRef = useRef(false);
  const [shouldShowGreetingPrompt, setShouldShowGreetingPrompt] = useState(false);
  const [localGreetingError, setLocalGreetingError] = useState('');
  const errorDismissTimeoutRef = useRef(null);

  const greetingAudio = greetingPlayback ? greetingPlayback.audio : null;
  const greetingEnabled = Boolean(greetingPlayback && (greetingPlayback.enabled || greetingPlayback.ready));
  const remoteGreetingError = greetingEnabled && greetingPlayback && greetingPlayback.error ? greetingPlayback.error : '';
  const hasGreetingError = Boolean(localGreetingError || remoteGreetingError);
  const currentGreetingErrorKey = hasGreetingError
    ? `${remoteGreetingError || ''}||${localGreetingError || ''}`
    : '';
  const [dismissedGreetingErrorKey, setDismissedGreetingErrorKey] = useState(null);
  const isGreetingReady = Boolean(
    greetingPlayback &&
      greetingPlayback.ready &&
      typeof Audio !== 'undefined' &&
      greetingAudio instanceof Audio,
  );

  useEffect(() => {
    if (!isGreetingReady) {
      greetingAudioRef.current = null;
      setShouldShowGreetingPrompt(false);
      return undefined;
    }

    const audioElement = greetingAudio;
    if (!(audioElement instanceof Audio)) {
      greetingAudioRef.current = null;
      setShouldShowGreetingPrompt(false);
      return undefined;
    }

    const readyStateThreshold =
      typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.HAVE_CURRENT_DATA : 2;

    let cancelled = false;

    const markReady = () => {
      if (cancelled) return;
      if (greetingAudioRef.current !== audioElement) {
        greetingAudioRef.current = audioElement;
      }
      setShouldShowGreetingPrompt(true);
      setLocalGreetingError('');
    };

    const handleError = (event) => {
      if (cancelled) return;
      console.warn('Failed to load greeting audio', event);
      greetingAudioRef.current = null;
      setShouldShowGreetingPrompt(false);
      setLocalGreetingError('Greeting audio is unavailable.');
    };

    if (typeof audioElement.readyState === 'number' && audioElement.readyState >= readyStateThreshold) {
      markReady();
      return () => {
        cancelled = true;
      };
    }

    audioElement.preload = 'auto';

    const handleReady = () => {
      audioElement.removeEventListener('canplaythrough', handleReady);
      audioElement.removeEventListener('loadeddata', handleReady);
      audioElement.removeEventListener('error', handleError);
      markReady();
    };

    audioElement.addEventListener('canplaythrough', handleReady);
    audioElement.addEventListener('loadeddata', handleReady);
    audioElement.addEventListener('error', handleError);

    try {
      audioElement.load();
    } catch (error) {
      console.warn('Failed to prime greeting audio', error);
    }

    return () => {
      cancelled = true;
      audioElement.removeEventListener('canplaythrough', handleReady);
      audioElement.removeEventListener('loadeddata', handleReady);
      audioElement.removeEventListener('error', handleError);
    };
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
      audioElement.pause();
    } catch (error) {
      console.warn('Failed to pause greeting audio before replay', error);
    }
    try {
      audioElement.currentTime = 0;
    } catch (error) {
      console.warn('Failed to reset greeting audio', error);
    }
    let playPromise;
    try {
      playPromise = audioElement.play();
    } catch (error) {
      isPlayingGreetingRef.current = false;
      console.warn('Failed to play greeting audio', error);
      setLocalGreetingError('Unable to play greeting audio. Tap to retry.');
      setShouldShowGreetingPrompt(true);
      return;
    }
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

  useEffect(() => {
    if (errorDismissTimeoutRef.current) {
      clearTimeout(errorDismissTimeoutRef.current);
      errorDismissTimeoutRef.current = null;
    }

    if (!currentGreetingErrorKey) {
      setDismissedGreetingErrorKey(null);
      return undefined;
    }

    setDismissedGreetingErrorKey(null);

    if (typeof window === 'undefined') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (errorDismissTimeoutRef.current === timeoutId) {
        errorDismissTimeoutRef.current = null;
      }
      if (localGreetingError) {
        setLocalGreetingError('');
      }
      setShouldShowGreetingPrompt(false);
      setDismissedGreetingErrorKey(currentGreetingErrorKey);
    }, 45000);

    errorDismissTimeoutRef.current = timeoutId;

    return () => {
      clearTimeout(timeoutId);
      if (errorDismissTimeoutRef.current === timeoutId) {
        errorDismissTimeoutRef.current = null;
      }
    };
  }, [currentGreetingErrorKey, localGreetingError]);

  const shouldDisplayGreetingToast =
    shouldShowGreetingPrompt ||
    (greetingEnabled && currentGreetingErrorKey && currentGreetingErrorKey !== dismissedGreetingErrorKey);

  const navContextValue = useMemo(
    () => ({
      toggleNav,
      closeNav,
      isNavOpen,
      showNav,
      navId,
      registerNavAnchor,
      setBackLink: updateBackLink,
      backLink,
    }),
    [toggleNav, closeNav, isNavOpen, showNav, navId, registerNavAnchor, updateBackLink, backLink],
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
          <MainNav
            isOpen={isNavOpen}
            onNavigate={closeNav}
            navId={navId}
            backLink={backLink}
          />
        )}
        {showNav && (
          <div className="app-layout__scrim" aria-hidden="true" onClick={closeNav} />
        )}
        <main
          id="main-content"
          className={`app-layout__content${isDashboardRoute ? ' app-layout__content--dashboard' : ''}`}
          tabIndex={-1}
        >
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
