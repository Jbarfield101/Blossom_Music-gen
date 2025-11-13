export const HOLIDAYS_BY_DATE = {
  '2024-01-01': [
    {
      name: "New Year's Day",
      summary: 'First day of the Gregorian calendar year.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-01-15': [
    {
      name: 'Martin Luther King Jr. Day',
      summary: 'Honors the life and legacy of Dr. Martin Luther King Jr.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-02-19': [
    {
      name: "Presidents' Day",
      summary: 'Celebrates all U.S. presidents with emphasis on Washington and Lincoln.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-05-27': [
    {
      name: 'Memorial Day',
      summary: 'Remembers U.S. military personnel who died in service.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-06-19': [
    {
      name: 'Juneteenth National Independence Day',
      summary: 'Commemorates the emancipation of enslaved African Americans in the United States.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-07-04': [
    {
      name: 'Independence Day',
      summary: 'Marks the adoption of the Declaration of Independence in 1776.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-09-02': [
    {
      name: 'Labor Day',
      summary: 'Honors the social and economic achievements of workers.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-11-11': [
    {
      name: 'Veterans Day',
      summary: 'Honors military veterans of the United States Armed Forces.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-11-28': [
    {
      name: 'Thanksgiving Day',
      summary: 'Day of gratitude and harvest celebration shared with family and friends.',
      type: 'federal',
      regions: ['US'],
    },
  ],
  '2024-12-25': [
    {
      name: 'Christmas Day',
      summary: 'Celebration of Christmas, observed as a cultural and religious holiday.',
      type: 'federal',
      regions: ['US'],
    },
  ],
};

function normalizeHolidayEntry(dateKey, entry, index) {
  if (entry == null) {
    return null;
  }

  if (typeof entry === 'string') {
    const title = entry.trim();
    if (!title) {
      return null;
    }
    return buildHolidayEvent(dateKey, { name: title }, index);
  }

  if (typeof entry === 'object') {
    const normalizedName = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!normalizedName) {
      return null;
    }
    return buildHolidayEvent(
      dateKey,
      {
        ...entry,
        name: normalizedName,
        summary: typeof entry.summary === 'string' ? entry.summary.trim() : '',
      },
      index
    );
  }

  return null;
}

function buildHolidayEvent(dateKey, entry, index) {
  const startMinutes = 0;
  const endMinutes = 23 * 60 + 59;

  return {
    id: `holiday-${dateKey}-${index}`,
    title: entry.name,
    description: entry.summary ?? '',
    category: 'holiday',
    dateKey,
    startTime: '00:00',
    endTime: '23:59',
    startMinutes,
    endMinutes,
    recurrence: 'annual',
    reminderOffsetMinutes: 0,
    remoteId: null,
    immutable: true,
    allDay: true,
    metadata: {
      ...entry,
      dateKey,
    },
  };
}

export function createHolidayEventsByDate(holidayMap = HOLIDAYS_BY_DATE) {
  if (!holidayMap || typeof holidayMap !== 'object') {
    return {};
  }

  return Object.entries(holidayMap).reduce((accumulator, [dateKey, rawEntries]) => {
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    const events = entries
      .map((entry, index) => normalizeHolidayEntry(dateKey, entry, index))
      .filter(Boolean);

    if (events.length > 0) {
      accumulator[dateKey] = events;
    }

    return accumulator;
  }, {});
}
