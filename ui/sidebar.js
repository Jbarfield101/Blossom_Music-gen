(function () {
  function init() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const toggle = document.getElementById('sidebar-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }

    const current = window.location.pathname.replace(/\/index\.html$/, '/');
    const links = sidebar.querySelectorAll('a[href]');
    links.forEach(link => {
      const linkPath = new URL(link.getAttribute('href'), window.location.href)
        .pathname.replace(/\/index\.html$/, '/');
      if (linkPath === current) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
