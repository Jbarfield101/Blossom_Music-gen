/**
 * Persist the UI theme using Tauri's store plugin when available,
 * falling back to localStorage otherwise.
 */
let store = null;
let currentTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', currentTheme);

window.setTheme = async function(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  if (store) {
    await store.set('theme', theme);
    await store.save();
  }
  localStorage.setItem('theme', theme);
};

window.getTheme = function() {
  return currentTheme;
};

(async () => {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    store = new Store('.settings.dat');
    const saved = await store.get('theme');
    if (saved) {
      currentTheme = saved;
      document.documentElement.setAttribute('data-theme', saved);
      localStorage.setItem('theme', saved);
    } else {
      await store.set('theme', currentTheme);
      await store.save();
    }
  } catch (_) {
    // Store plugin not available; localStorage already handles persistence.
  }
})();
