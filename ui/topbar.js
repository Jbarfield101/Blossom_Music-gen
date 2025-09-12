(function() {
  const style = document.createElement('style');
  style.textContent = `
    #top-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: var(--topbar-bg);
      color: var(--text-color);
      padding: 0.5rem;
      display: flex;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }
    body { padding-top: 2.5rem; }
    #top-bar button {
      background: var(--button-bg);
      color: var(--text-color);
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
  document.body.prepend(bar);
})();
