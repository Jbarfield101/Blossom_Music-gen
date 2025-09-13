(function() {
  function $(id) { return document.getElementById(id); }

  function load() {
    const outdir = localStorage.getItem('default_outdir') || '';
    const theme = (window.getTheme && window.getTheme()) || 'dark';
    const outInput = $('default_outdir');
    const themeSel = $('theme');
    if (outInput) outInput.value = outdir;
    if (themeSel) {
      themeSel.value = theme;
      themeSel.addEventListener('change', () => window.setTheme(themeSel.value));
    }
  }

  function save() {
    const outInput = $('default_outdir');
    const themeSel = $('theme');
    if (outInput) localStorage.setItem('default_outdir', outInput.value);
    if (themeSel) window.setTheme(themeSel.value);
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    const saveBtn = $('save');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const darkBtn = $('set_dark');
    if (darkBtn) darkBtn.addEventListener('click', () => {
      window.setTheme('dark');
      const themeSel = $('theme');
      if (themeSel) themeSel.value = 'dark';
    });
  });
})();
