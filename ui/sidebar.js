(function() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/ui/sidebar.css';
  document.head.appendChild(link);

  const sidebar = document.createElement('nav');
  sidebar.id = 'sidebar';

  const items = [
    {
      href: 'generate.html',
      label: 'Music Generator',
      icon: `<svg viewBox="0 0 64 64" aria-hidden="true" fill="var(--icon)"><title>Music Generator</title><path d="M48 4v32.9c-2.3-1.4-5-2.2-8-2.2-6.6 0-12 4.5-12 10s5.4 10 12 10 12-4.5 12-10V14h12V4H48z"/></svg>`
    },
    {
      href: 'dnd.html',
      label: 'Dungeons & Dragons',
      icon: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="var(--icon)"><title>Dungeons and Dragons</title><polygon points="12,2 2,12 12,22 22,12"/></svg>`
    },
    {
      href: 'settings.html',
      label: 'Settings',
      icon: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="var(--icon)"><title>Settings</title><circle cx="12" cy="12" r="3"/><rect x="11" y="2" width="2" height="4"/><rect x="11" y="18" width="2" height="4"/><rect x="2" y="11" width="4" height="2"/><rect x="18" y="11" width="4" height="2"/><rect x="4.22" y="4.22" width="2" height="4" transform="rotate(-45 5.22 6.22)"/><rect x="17.78" y="15.78" width="2" height="4" transform="rotate(-45 18.78 17.78)"/><rect x="4.22" y="15.78" width="2" height="4" transform="rotate(45 5.22 17.78)"/><rect x="17.78" y="4.22" width="2" height="4" transform="rotate(45 18.78 6.22)"/></svg>`
    },
    {
      href: 'train.html',
      label: 'Train Model',
      icon: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="var(--icon)"><title>Train Model</title><rect x="4" y="10" width="3" height="10"/><rect x="10" y="6" width="3" height="14"/><rect x="16" y="2" width="3" height="18"/></svg>`
    },
    {
      href: 'models.html',
      label: 'Manage Models',
      icon: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="var(--icon)"><title>Manage Models</title><path d="M3 7l9-5 9 5-9 5-9-5zm0 5l9 5 9-5v10l-9 5-9-5z"/></svg>`
    },
    {
      href: 'onnx.html',
      label: 'ONNX Crafter',
      icon: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="var(--icon)"><title>ONNX Crafter</title><circle cx="12" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><circle cx="12" cy="19" r="3"/><path d="M12 8v8M9 12h6M8 11l-2 2M16 11l2 2" stroke="var(--icon)" stroke-width="1" fill="none"/></svg>`
    }
  ];

  items.forEach(item => {
    const a = document.createElement('a');
    a.href = item.href;
    a.setAttribute('aria-label', item.label);
    a.innerHTML = `${item.icon}<span>${item.label}</span>`;
    sidebar.appendChild(a);
  });

  const toggle = document.createElement('button');
  toggle.id = 'sidebar-toggle';
  toggle.setAttribute('aria-label', 'Toggle sidebar');
  toggle.innerHTML = `<svg viewBox="0 0 24 24" fill="var(--icon)"><title>Toggle sidebar</title><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>`;
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  document.body.appendChild(sidebar);
  document.body.appendChild(toggle);
})();
