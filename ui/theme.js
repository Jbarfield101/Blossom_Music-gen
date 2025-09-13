// Persist the UI theme using Tauri's store plugin when available.
// Falls back to `localStorage` when the plugin cannot be loaded
// (e.g. when running purely in a browser context).
import { Store } from '@tauri-apps/plugin-store';

const THEME_KEY = 'theme';
const ACCENT_KEY = 'accent';
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

export async function setAccent(color) {
  if (store) {
    try {
      await store.set(ACCENT_KEY, color);
      await store.save();
    } catch (_) {
      localStorage.setItem(ACCENT_KEY, color);
    }
  } else {
    localStorage.setItem(ACCENT_KEY, color);
  }
  document.documentElement.style.setProperty('--accent', color);
}

export async function getAccent() {
  if (store) {
    try {
      const color = await store.get(ACCENT_KEY);
      if (color) return color;
    } catch (_) {}
  }
  return localStorage.getItem(ACCENT_KEY);
}

getTheme().then((savedTheme) => setTheme(savedTheme || 'dark'));
getAccent().then((savedAccent) => savedAccent && setAccent(savedAccent));
