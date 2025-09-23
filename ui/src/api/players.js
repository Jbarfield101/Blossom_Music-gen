import { invoke } from '@tauri-apps/api/core';

export const createPlayer = ({
  name,
  markdown,
  sheet,
  template,
  directory,
  usePrefill,
  prefillPrompt,
}) =>
  invoke('player_create', {
    name,
    markdown,
    sheet,
    template,
    directory,
    usePrefill,
    prefillPrompt,
  });
