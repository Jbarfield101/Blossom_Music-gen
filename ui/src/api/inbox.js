import { invoke } from '@tauri-apps/api/core';

export const listInbox = (path) => invoke('inbox_list', { path });
export const readInbox = (path) => invoke('inbox_read', { path });
export const createInbox = (name, content = '', basePath = null) =>
  invoke('inbox_create', { name, content, basePath });
export const updateInbox = (path, content) => invoke('inbox_update', { path, content });
export const deleteInbox = (path) => invoke('inbox_delete', { path });
export const moveInboxItem = ({
  path,
  target,
  title = null,
  tags = null,
  frontmatter = null,
  content = null,
}) =>
  invoke('inbox_move_to', {
    path,
    target,
    title,
    tags,
    frontmatter,
    content,
  });
