const BASE_PATH = '/api/world-inventory';

async function request(path, { method = 'GET', body, headers } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_PATH}${path}`, opts);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const snippet = text ? `: ${text.substring(0, 200)}` : '';
    throw new Error(`World inventory request failed (${response.status})${snippet}`);
  }
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

const encodeId = (value) => encodeURIComponent(value ?? '');

export function fetchWorldInventorySnapshot() {
  return request('/snapshot');
}

export function fetchWorldInventoryChangeLog(limit = 50) {
  const params = new URLSearchParams();
  if (Number.isFinite(limit)) {
    params.set('limit', String(limit));
  }
  const suffix = params.toString() ? `?${params}` : '';
  return request(`/changes${suffix}`);
}

export function searchWorldInventoryItems({
  query = '',
  tags = [],
  quests = [],
  ownerId = '',
  containerId = '',
} = {}) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  for (const tag of tags || []) {
    if (!tag) continue;
    params.append('tag', tag);
  }
  for (const quest of quests || []) {
    if (!quest) continue;
    params.append('quest', quest);
  }
  if (ownerId) params.set('ownerId', ownerId);
  if (containerId) params.set('containerId', containerId);
  const suffix = params.toString() ? `?${params}` : '';
  return request(`/items${suffix}`);
}

export function createWorldInventoryItem(payload) {
  return request('/items', { method: 'POST', body: payload });
}

export function updateWorldInventoryItem(itemId, changes) {
  return request(`/items/${encodeId(itemId)}`, { method: 'PATCH', body: changes });
}

export function deleteWorldInventoryItem(itemId) {
  return request(`/items/${encodeId(itemId)}`, { method: 'DELETE' });
}

export function persistWorldInventoryItem(itemId, changes) {
  return updateWorldInventoryItem(itemId, changes);
}

export function moveWorldInventoryItem(itemId, targets) {
  return updateWorldInventoryItem(itemId, targets);
}

export function createWorldInventoryLedgerEntry(itemId, entry) {
  return request(`/items/${encodeId(itemId)}/ledger`, { method: 'POST', body: entry });
}

export function updateWorldInventoryLedgerEntry(itemId, entryId, entry) {
  return request(`/items/${encodeId(itemId)}/ledger/${encodeId(entryId)}`, {
    method: 'PATCH',
    body: entry,
  });
}

export function deleteWorldInventoryLedgerEntry(itemId, entryId) {
  return request(`/items/${encodeId(itemId)}/ledger/${encodeId(entryId)}`, {
    method: 'DELETE',
  });
}

export function createWorldInventoryOwner(payload) {
  return request('/owners', { method: 'POST', body: payload });
}

export function updateWorldInventoryOwner(ownerId, changes) {
  return request(`/owners/${encodeId(ownerId)}`, { method: 'PATCH', body: changes });
}

export function deleteWorldInventoryOwner(ownerId) {
  return request(`/owners/${encodeId(ownerId)}`, { method: 'DELETE' });
}

export function createWorldInventoryContainer(payload) {
  return request('/containers', { method: 'POST', body: payload });
}

export function updateWorldInventoryContainer(containerId, changes) {
  return request(`/containers/${encodeId(containerId)}`, {
    method: 'PATCH',
    body: changes,
  });
}

export function deleteWorldInventoryContainer(containerId) {
  return request(`/containers/${encodeId(containerId)}`, { method: 'DELETE' });
}

export function createWorldInventoryLocation(payload) {
  return request('/locations', { method: 'POST', body: payload });
}

export function updateWorldInventoryLocation(locationId, changes) {
  return request(`/locations/${encodeId(locationId)}`, {
    method: 'PATCH',
    body: changes,
  });
}

export function deleteWorldInventoryLocation(locationId) {
  return request(`/locations/${encodeId(locationId)}`, { method: 'DELETE' });
}

export function createWorldInventorySet(payload) {
  return request('/sets', { method: 'POST', body: payload });
}

export function updateWorldInventorySet(setId, changes) {
  return request(`/sets/${encodeId(setId)}`, { method: 'PATCH', body: changes });
}

export function deleteWorldInventorySet(setId) {
  return request(`/sets/${encodeId(setId)}`, { method: 'DELETE' });
}

export function createWorldInventoryQuestLink(payload) {
  return request('/quest-links', { method: 'POST', body: payload });
}

export function updateWorldInventoryQuestLink(linkId, changes) {
  return request(`/quest-links/${encodeId(linkId)}`, { method: 'PATCH', body: changes });
}

export function deleteWorldInventoryQuestLink(linkId) {
  return request(`/quest-links/${encodeId(linkId)}`, { method: 'DELETE' });
}

