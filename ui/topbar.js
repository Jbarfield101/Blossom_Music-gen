(function() {
  const style = document.createElement('style');
  style.textContent = `
    #top-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #111;
      color: #fff;
      padding: 0.5rem;
      display: flex;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }
    body { padding-top: 2.5rem; }
    #top-bar button {
      background: #444;
      color: #fff;
      border: none;
      padding: 0.25rem 0.5rem;
      cursor: pointer;
    }
    #top-bar button:hover {
      background: #555;
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
