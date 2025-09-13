(function() {
  // Persist theme selection via Tauri's Store plugin with a
  // graceful fallback to localStorage when the plugin isn't available.
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  const fallback = localStorage.getItem('theme') || 'dark';
  apply(fallback);

  let store;
  async function init() {
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      store = new Store('.settings.dat');
      const saved = await store.get('theme');
      if (typeof saved === 'string') {
        apply(saved);
      }
    } catch (e) {
      // plugin not available; rely on localStorage
    }
  }

  init();

  window.setTheme = async function(theme) {
    apply(theme);
    try {
      if (store) {
        await store.set('theme', theme);
        await store.save();
      } else {
        localStorage.setItem('theme', theme);
      }
    } catch (e) {
      localStorage.setItem('theme', theme);
    }
  };
})();
