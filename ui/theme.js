// Persist the UI theme using Tauri's store plugin when available.
// Falls back to `localStorage` when the plugin cannot be loaded
// (e.g. when running purely in a browser context).
import { Store } from '@tauri-apps/plugin-store';

const THEME_KEY = 'theme';
let store;
try {
  store = new Store('settings.dat');
} catch (_) {
  store = null;
}

export async function setTheme(theme) {
  if (store) {
    try {
      await store.set(THEME_KEY, theme);
      await store.save();
    } catch (_) {
      localStorage.setItem(THEME_KEY, theme);
    }
  } else {
    localStorage.setItem(THEME_KEY, theme);
  }
  document.documentElement.dataset.theme = theme;
}

export async function getTheme() {
  if (store) {
    try {
      const theme = await store.get(THEME_KEY);
      if (theme) return theme;
    } catch (_) {}
  }
  return localStorage.getItem(THEME_KEY);
}

getTheme().then((savedTheme) => setTheme(savedTheme || 'dark'));
