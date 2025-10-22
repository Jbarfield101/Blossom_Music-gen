export const DOMAIN_CATEGORY_OPTIONS = [
  { value: 'Celestial', label: 'Celestial' },
  { value: 'Tempest', label: 'Tempest' },
  { value: 'Harvest', label: 'Harvest' },
  { value: 'Shadow', label: 'Shadow' },
  { value: 'War', label: 'War' },
  { value: 'Knowledge', label: 'Knowledge' },
  { value: 'Wilds', label: 'Wilds' },
  { value: 'Mystic', label: 'Mystic' },
  { value: 'Arcane', label: 'Arcane' },
  { value: 'Industrial', label: 'Industrial' },
];

export const DEFAULT_DOMAIN_CATEGORY = '';

export const DOMAIN_CATEGORY_SUGGESTIONS = DOMAIN_CATEGORY_OPTIONS.map(
  (option) => option.label,
);
