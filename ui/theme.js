// Persist the UI theme using the backend config API when available.
// Falls back to `localStorage` when the API cannot be called
// (e.g. when running purely in a browser context).
import { getConfig, setConfig } from './src/api/config';

const THEME_KEY = 'theme';
const ACCENT_KEY = 'accent';
const FONT_SIZE_KEY = 'base_font_size';

export async function setTheme(theme) {
  try {
    await setConfig(THEME_KEY, theme);
  } catch (_) {
    localStorage.setItem(THEME_KEY, theme);
  }
  document.documentElement.dataset.theme = theme;
}

export async function getTheme() {
  try {
    const theme = await getConfig(THEME_KEY);
    if (theme) return theme;
  } catch (_) {}
  return localStorage.getItem(THEME_KEY);
}

export async function setAccent(color) {
  try {
    await setConfig(ACCENT_KEY, color);
  } catch (_) {
    localStorage.setItem(ACCENT_KEY, color);
  }
  document.documentElement.style.setProperty('--accent', color);
}

export async function getAccent() {
  try {
    const color = await getConfig(ACCENT_KEY);
    if (color) return color;
  } catch (_) {}
  return localStorage.getItem(ACCENT_KEY);
}

export async function setBaseFontSize(size) {
  try {
    await setConfig(FONT_SIZE_KEY, size);
  } catch (_) {
    localStorage.setItem(FONT_SIZE_KEY, size);
  }
  document.documentElement.style.setProperty('--base-font-size', size);
}

export async function getBaseFontSize() {
  try {
    const size = await getConfig(FONT_SIZE_KEY);
    if (size) return size;
  } catch (_) {}
  return localStorage.getItem(FONT_SIZE_KEY);
}

getTheme().then((savedTheme) => setTheme(savedTheme || 'dark'));
getAccent().then((savedAccent) => savedAccent && setAccent(savedAccent));
getBaseFontSize().then((savedSize) => savedSize && setBaseFontSize(savedSize));
