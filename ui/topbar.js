(function() {
  const style = document.createElement('style');
  style.textContent = `
    #top-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: var(--card-bg);
      color: var(--text);
      padding: 0.5rem;
      display: flex;
      align-items: center;
      box-shadow: var(--topbar-shadow);
    }
    body { padding-top: 2.5rem; }
    #top-bar button {
      background: var(--button-bg);
      color: var(--text);
      border: none;
      padding: 0.25rem 0.5rem;
      cursor: pointer;
    }
    #top-bar button:hover {
      background: var(--button-hover-bg);
    }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'top-bar';
  const back = document.createElement('button');
  back.textContent = 'Back';
  back.addEventListener('click', () => history.back());
  bar.appendChild(back);
  const about = document.createElement('button');
  about.textContent = 'About';
  about.addEventListener('click', async () => {
    try {
      const data = await window.__TAURI__.invoke('app_version');
      alert(`App version: ${data.app}\nPython version: ${data.python}`);
    } catch (err) {
      alert('Failed to fetch version');
    }
  });
  bar.appendChild(about);

  document.body.prepend(bar);
})();
