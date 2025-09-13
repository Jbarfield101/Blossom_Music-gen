export function setTheme(theme) {
  localStorage.setItem('theme', theme);
  document.documentElement.dataset.theme = theme;
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  setTheme(savedTheme);
}

