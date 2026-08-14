/**
 * Deadline urgency.
 *
 * A raw due date is not very useful on a board — "Aug 12" only means something
 * once you have worked out what today is. This turns the date into the thing
 * the user actually wants to know: does this need me now?
 *
 * The order below is the attention hierarchy from the design brief:
 *   OVERDUE > TODAY > SOON > SCHEDULED > NONE
 */

export const URGENCY = {
  OVERDUE: 'overdue',
  TODAY: 'today',
  SOON: 'soon',
  SCHEDULED: 'scheduled',
  NONE: 'none',
};

/** Days ahead that still count as "soon" rather than just scheduled. */
const SOON_WITHIN_DAYS = 3;

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Whole days from today to `date`. Negative means the past.
 * Compared at day boundaries so a task due later today reads as "today",
 * not as overdue the moment its timestamp passes.
 */
const daysFromToday = (date) => {
  const diff = startOfDay(date).getTime() - startOfDay(new Date()).getTime();
  return Math.round(diff / 86400000);
};

/**
 * @returns {{ level: string, label: string, days: number|null }}
 */
export function getUrgency(task) {
  // A finished task cannot be late. Counting completed work as overdue was one
  // of the correctness bugs in the old analytics, and the board should not
  // reintroduce it visually.
  if (task?.status === 'done') return { level: URGENCY.NONE, label: '', days: null };
  if (!task?.dueDate) return { level: URGENCY.NONE, label: '', days: null };

  const days = daysFromToday(task.dueDate);

  if (days < 0) {
    return {
      level: URGENCY.OVERDUE,
      label: days === -1 ? 'Overdue by 1 day' : `Overdue by ${Math.abs(days)} days`,
      days,
    };
  }

  if (days === 0) return { level: URGENCY.TODAY, label: 'Due today', days };
  if (days === 1) return { level: URGENCY.SOON, label: 'Due tomorrow', days };
  if (days <= SOON_WITHIN_DAYS) return { level: URGENCY.SOON, label: `Due in ${days} days`, days };

  return { level: URGENCY.SCHEDULED, label: '', days };
}

/** True when a task has no one working on it and is not finished. */
export const isUnassigned = (task) =>
  !task?.assignee && task?.status !== 'done';

/**
 * Board-wide counts for the "attention required" strip.
 *
 * Computed in one pass — the board already learned this lesson with status
 * grouping, and three more filter() calls over the task list would undo it.
 */
export function getAttention(tasks) {
  const counts = { overdue: 0, today: 0, unassigned: 0 };

  (tasks ?? []).forEach((task) => {
    const { level } = getUrgency(task);
    if (level === URGENCY.OVERDUE) counts.overdue += 1;
    else if (level === URGENCY.TODAY) counts.today += 1;

    if (isUnassigned(task)) counts.unassigned += 1;
  });

  return counts;
}

/** Does a task belong to the given attention filter? */
export function matchesAttention(task, filter) {
  if (!filter) return true;
  if (filter === 'unassigned') return isUnassigned(task);
  return getUrgency(task).level === filter;
}

/**
 * A short, stable, human-quotable id derived from the Mongo ObjectId.
 *
 * Purely presentational — it gives the retro "work ticket" its number without
 * inventing a second identifier the server would have to know about.
 */
export function taskRef(id) {
  if (typeof id !== 'string' || id.length < 4) return 'TASK-????';
  return `TASK-${id.slice(-4).toUpperCase()}`;
}
