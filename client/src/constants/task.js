/**
 * Shared task vocabulary.
 *
 * Mirrors `server/constants.js` — the two must be changed together. These were
 * previously re-declared inline in Board, TasksContainer, Card and
 * TaskProvider, which is how the four copies drifted apart.
 */

export const TASK_STATUSES = [
  { value: 'backlog', title: 'Backlog' },
  { value: 'todo', title: 'To do' },
  { value: 'inProgress', title: 'In progress' },
  { value: 'done', title: 'Done' },
];

export const STATUS_VALUES = TASK_STATUSES.map((status) => status.value);

export const STATUS_TITLES = TASK_STATUSES.reduce((acc, status) => {
  acc[status.value] = status.title;
  return acc;
}, {});

export const TASK_PRIORITIES = [
  { value: 'high', label: 'HIGH PRIORITY', shortLabel: 'High', color: '#ff2473' },
  { value: 'moderate', label: 'MODERATE PRIORITY', shortLabel: 'Moderate', color: '#18b0ff' },
  { value: 'low', label: 'LOW PRIORITY', shortLabel: 'Low', color: '#63c05b' },
];

export const PRIORITY_VALUES = TASK_PRIORITIES.map((priority) => priority.value);

/**
 * Board date filters.
 *
 * `all` is offered first and is what the empty/reset state falls back to,
 * because a filter must never make a user think their tasks were deleted.
 * The API only applies these to *completed* tasks — open work always shows.
 */
export const DATE_RANGES = [
  { id: 'all', name: 'All time', value: 'all' },
  { id: 'today', name: 'Today', value: 'today' },
  { id: 'week', name: 'This week', value: 'week' },
  { id: 'month', name: 'This month', value: 'month' },
];

export const DEFAULT_DATE_RANGE = DATE_RANGES.find((range) => range.value === 'week');

export const MIN_PASSWORD_LENGTH = 8;

export const EMAIL_REGEX = /^[\w-.]+@([\w-]+\.)+[\w-]{2,}$/;
