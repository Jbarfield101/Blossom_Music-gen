import { useEffect, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import './EventModal.css';

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'minutely', label: 'Every minute' },
];

function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return Number.NaN;
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return Number.NaN;
  return hours * 60 + minutes;
}

function sanitizeCategory(value, categories) {
  if (typeof value !== 'string') {
    return categories[0]?.id ?? 'custom';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return categories[0]?.id ?? 'custom';
  }
  return categories.some((category) => category.id === trimmed)
    ? trimmed
    : categories[0]?.id ?? 'custom';
}

function createInitialValues(draft, categories) {
  const fallbackCategory = categories[0]?.id ?? 'custom';
  return {
    title: draft?.title ?? '',
    description: draft?.description ?? '',
    category: sanitizeCategory(draft?.category ?? fallbackCategory, categories),
    date: draft?.date ?? '',
    startTime: draft?.startTime ?? '09:00',
    endTime: draft?.endTime ?? '10:00',
    recurrence: draft?.recurrence ?? 'none',
    reminderOffsetMinutes: draft?.reminderOffsetMinutes ?? 0,
    remoteId: draft?.remoteId ?? null,
  };
}

export default function EventModal({
  open,
  mode,
  draft,
  categories,
  onClose,
  onSubmit,
  onDelete,
  submitting,
  deleting,
  error,
}) {
  const [values, setValues] = useState(() => createInitialValues(draft, categories));
  const [localError, setLocalError] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setValues(createInitialValues(draft, categories));
    setLocalError('');
  }, [open, draft, categories]);

  useEffect(() => {
    if (!open) return undefined;
    const node = containerRef.current;
    if (!node) return undefined;

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = node.querySelectorAll(focusableSelector);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      node.focus();
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const elements = Array.from(node.querySelectorAll(focusableSelector)).filter(
        (el) => !el.hasAttribute('disabled')
      );
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !node.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const handleChange = useCallback((event) => {
    const { name, value } = event.target;
    setLocalError('');
    setValues((prev) => ({
      ...prev,
      [name]: name === 'reminderOffsetMinutes' ? value : value,
    }));
  }, []);

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      if (submitting || deleting) return;
      if (!values.date) {
        setLocalError('Please choose a date for this event.');
        return;
      }
      const startMinutes = parseTimeToMinutes(values.startTime);
      const endMinutes = parseTimeToMinutes(values.endTime);
      if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) {
        setLocalError('Please provide valid start and end times.');
        return;
      }
      if (startMinutes >= endMinutes) {
        setLocalError('The start time must be earlier than the end time.');
        return;
      }
      if (!values.title?.trim() && sanitizeCategory(values.category, categories) === 'custom') {
        setLocalError('Please provide a title for this event.');
        return;
      }
      onSubmit({
        ...values,
        category: sanitizeCategory(values.category, categories),
        reminderOffsetMinutes:
          values.reminderOffsetMinutes === ''
            ? 0
            : Number.parseInt(values.reminderOffsetMinutes, 10) || 0,
      });
    },
    [categories, deleting, onSubmit, submitting, values]
  );

  const handleDelete = useCallback(() => {
    if (!onDelete || values.remoteId == null || submitting || deleting) {
      return;
    }
    onDelete(values);
  }, [deleting, onDelete, submitting, values]);

  if (!open) {
    return null;
  }

  const disabled = submitting || deleting;
  const resolvedError = localError || error;
  const modeLabel = mode === 'edit' ? 'Update event' : 'Create event';

  return (
    <div
      className="event-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="event-modal"
        ref={containerRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="event-modal-header">
          <div>
            <h2 id="event-modal-title" className="event-modal-title">
              {mode === 'edit' ? 'Edit event' : 'New event'}
            </h2>
            <p className="event-modal-subtitle">Fill in the details and we will handle the reminders.</p>
          </div>
          <button type="button" className="event-modal-close" onClick={onClose} aria-label="Close event modal">
            ×
          </button>
        </header>
        <form className="event-modal-form" onSubmit={handleSubmit}>
          <label className="event-modal-field">
            <span className="event-modal-label">Title</span>
            <input
              type="text"
              name="title"
              value={values.title}
              onChange={handleChange}
              placeholder="Name your event"
              disabled={disabled}
            />
          </label>
          <label className="event-modal-field">
            <span className="event-modal-label">Description</span>
            <textarea
              name="description"
              value={values.description}
              onChange={handleChange}
              rows={3}
              placeholder="Add optional context"
              disabled={disabled}
            />
          </label>
          <div className="event-modal-grid">
            <label className="event-modal-field">
              <span className="event-modal-label">Category</span>
              <select
                name="category"
                value={values.category}
                onChange={handleChange}
                disabled={disabled}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="event-modal-field">
              <span className="event-modal-label">Recurrence</span>
              <select
                name="recurrence"
                value={values.recurrence}
                onChange={handleChange}
                disabled={disabled}
              >
                {RECURRENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="event-modal-field">
              <span className="event-modal-label">Date</span>
              <input
                type="date"
                name="date"
                value={values.date}
                onChange={handleChange}
                disabled={disabled}
              />
            </label>
            <label className="event-modal-field">
              <span className="event-modal-label">Reminder (minutes before)</span>
              <input
                type="number"
                min="0"
                step="1"
                name="reminderOffsetMinutes"
                value={values.reminderOffsetMinutes}
                onChange={handleChange}
                disabled={disabled}
              />
            </label>
            <label className="event-modal-field">
              <span className="event-modal-label">Start time</span>
              <input
                type="time"
                name="startTime"
                value={values.startTime}
                onChange={handleChange}
                disabled={disabled}
                step="300"
              />
            </label>
            <label className="event-modal-field">
              <span className="event-modal-label">End time</span>
              <input
                type="time"
                name="endTime"
                value={values.endTime}
                onChange={handleChange}
                disabled={disabled}
                step="300"
              />
            </label>
          </div>
          {resolvedError && (
            <p className="event-modal-error" role="alert">
              {resolvedError}
            </p>
          )}
          <div className="event-modal-actions">
            {mode === 'edit' && values.remoteId != null && (
              <button
                type="button"
                className="event-modal-button event-modal-button--danger"
                onClick={handleDelete}
                disabled={disabled}
              >
                Delete
              </button>
            )}
            <div className="event-modal-actions-end">
              <button type="button" className="event-modal-button" onClick={onClose} disabled={disabled}>
                Cancel
              </button>
              <button
                type="submit"
                className="event-modal-button event-modal-button--primary"
                disabled={disabled}
              >
                {submitting ? 'Saving…' : modeLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

EventModal.propTypes = {
  open: PropTypes.bool.isRequired,
  mode: PropTypes.oneOf(['create', 'edit']).isRequired,
  draft: PropTypes.shape({
    title: PropTypes.string,
    description: PropTypes.string,
    category: PropTypes.string,
    date: PropTypes.string,
    startTime: PropTypes.string,
    endTime: PropTypes.string,
    recurrence: PropTypes.string,
    reminderOffsetMinutes: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    remoteId: PropTypes.number,
  }),
  categories: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  submitting: PropTypes.bool,
  deleting: PropTypes.bool,
  error: PropTypes.string,
};

EventModal.defaultProps = {
  draft: null,
  onDelete: null,
  submitting: false,
  deleting: false,
  error: '',
};
