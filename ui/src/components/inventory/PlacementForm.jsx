import React from 'react';

export default function PlacementForm({
  ownerId,
  containerId,
  locationId,
  ownerOptions = [],
  containerOptions = [],
  locationOptions = [],
  pending,
  onChange,
}) {
  const handleChange = (field) => (event) => {
    onChange?.(field, event.target.value);
  };

  return (
    <section className="wi-panel">
      <div className="wi-panel-header">
        <h3>Ownership & Placement</h3>
      </div>
      <label>
        <span>Owner</span>
        <select value={ownerId || ''} onChange={handleChange('ownerId')} disabled={pending}>
          <option value="">Unassigned</option>
          {ownerOptions.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Container</span>
        <select value={containerId || ''} onChange={handleChange('containerId')} disabled={pending}>
          <option value="">Unassigned</option>
          {containerOptions.map((container) => (
            <option key={container.id} value={container.id}>
              {container.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Location</span>
        <select value={locationId || ''} onChange={handleChange('locationId')} disabled={pending}>
          <option value="">Unassigned</option>
          {locationOptions.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
