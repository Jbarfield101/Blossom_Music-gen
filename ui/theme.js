(function() {
  const themes = {
    dark: {
      '--bg-color': '#000',
      '--text-color': '#fff',
      '--panel-bg': '#111',
      '--panel-hover': '#222',
      '--topbar-bg': '#111',
      '--button-bg': '#444',
      '--button-hover-bg': '#555',
      '--log-bg': '#111',
      '--log-text': '#0f0'
    },
    light: {
      '--bg-color': '#fff',
      '--text-color': '#000',
      '--panel-bg': '#eee',
      '--panel-hover': '#ddd',
      '--topbar-bg': '#f0f0f0',
      '--button-bg': '#ddd',
      '--button-hover-bg': '#ccc',
      '--log-bg': '#eee',
      '--log-text': '#060'
    }
  };

  function applyTheme(name) {
    const theme = themes[name] || themes.dark;
    for (const [k, v] of Object.entries(theme)) {
      document.documentElement.style.setProperty(k, v);
    }
    localStorage.setItem('theme', name);
  }

  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);

  window.setTheme = applyTheme;
})();
