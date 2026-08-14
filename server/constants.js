/**
 * Single source of truth for domain vocabulary shared by the model, the
 * validation middleware and the controllers. The client mirrors these in
 * `client/src/constants/task.js` — change both together.
 */

const TASK_STATUSES = ['backlog', 'todo', 'inProgress', 'done'];

const TASK_PRIORITIES = ['high', 'moderate', 'low'];

/**
 * Board date filters.
 *
 * `all` exists so the default view can never hide unfinished work — see
 * `taskController.getTasks` for why the range only narrows completed tasks.
 */
const DATE_RANGES = ['all', 'today', 'week', 'month'];

const RANGE_TO_DAYS = {
  today: 1,
  week: 7,
  month: 30,
};

const MAX_TITLE_LENGTH = 200;
const MAX_CHECKLISTS = 100;
const MIN_PASSWORD_LENGTH = 8;

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

module.exports = {
  TASK_STATUSES,
  TASK_PRIORITIES,
  DATE_RANGES,
  RANGE_TO_DAYS,
  MAX_TITLE_LENGTH,
  MAX_CHECKLISTS,
  MIN_PASSWORD_LENGTH,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
