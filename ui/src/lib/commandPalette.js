export function openCommandPalette(options = {}) {
  if (typeof window === 'undefined') return;
  const detail = {};
  if (typeof options.query === 'string') {
    detail.query = options.query;
  }
  if (typeof options.templateId === 'string') {
    detail.templateId = options.templateId;
  }
  window.dispatchEvent(new CustomEvent('command-palette:open', { detail }));
}
