(function() {
  function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.menu button').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelector(`.menu button[data-section="${id}"]`).classList.add('active');
  }

  document.querySelectorAll('.menu button').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  document.getElementById('about-btn').addEventListener('click', async () => {
    const resp = await fetch('/about');
    if (resp.ok) {
      const data = await resp.json();
      document.getElementById('about-info').textContent = `Python ${data.python_version}`;
    }
  });

  const themeSelect = document.getElementById('theme-select');
  themeSelect.value = localStorage.getItem('theme') || 'dark';
  themeSelect.addEventListener('change', () => {
    setTheme(themeSelect.value);
  });
})();
