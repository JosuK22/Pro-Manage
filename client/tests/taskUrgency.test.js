import { describe, it, expect } from 'vitest';

import {
  URGENCY,
  getUrgency,
  getAttention,
  isUnassigned,
  matchesAttention,
  taskRef,
} from '../src/utils/taskUrgency';

/** A date `days` from now, at midday so timezone drift can't shift the day. */
const inDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

const task = (overrides = {}) => ({
  _id: '65f1a2b3c4d5e6f7a8b94f2a',
  title: 'Prepare report',
  status: 'todo',
  priority: 'high',
  assignee: 'mate@example.com',
  dueDate: null,
  checklists: [],
  ...overrides,
});

describe('getUrgency', () => {
  it('reports no urgency when there is no due date', () => {
    expect(getUrgency(task()).level).toBe(URGENCY.NONE);
  });

  // The board must not repeat the analytics bug of calling finished work late.
  it('never calls a completed task overdue, even long past its date', () => {
    const done = task({ status: 'done', dueDate: inDays(-30) });

    expect(getUrgency(done).level).toBe(URGENCY.NONE);
  });

  it('flags a past due date as overdue and counts the days', () => {
    const result = getUrgency(task({ dueDate: inDays(-3) }));

    expect(result.level).toBe(URGENCY.OVERDUE);
    expect(result.label).toBe('Overdue by 3 days');
  });

  it('uses the singular for one day late', () => {
    expect(getUrgency(task({ dueDate: inDays(-1) })).label).toBe('Overdue by 1 day');
  });

  // A task due at 09:00 today is due *today*, not overdue at 09:01.
  it('treats anything due today as due today, not overdue', () => {
    const earlier = new Date();
    earlier.setHours(0, 30, 0, 0);

    const result = getUrgency(task({ dueDate: earlier.toISOString() }));

    expect(result.level).toBe(URGENCY.TODAY);
    expect(result.label).toBe('Due today');
  });

  it('names tomorrow rather than counting to it', () => {
    expect(getUrgency(task({ dueDate: inDays(1) })).label).toBe('Due tomorrow');
  });

  it('treats the next few days as soon', () => {
    expect(getUrgency(task({ dueDate: inDays(3) })).level).toBe(URGENCY.SOON);
  });

  it('drops back to scheduled once a date is far enough away', () => {
    expect(getUrgency(task({ dueDate: inDays(20) })).level).toBe(URGENCY.SCHEDULED);
  });

  it('does not throw on a missing task', () => {
    expect(getUrgency(undefined).level).toBe(URGENCY.NONE);
  });
});

describe('isUnassigned', () => {
  it('is true for an open task with nobody on it', () => {
    expect(isUnassigned(task({ assignee: null }))).toBe(true);
  });

  it('is false once someone is assigned', () => {
    expect(isUnassigned(task())).toBe(false);
  });

  // Finished work needs no owner, so it should not sit in the attention strip.
  it('is false for completed work regardless of assignee', () => {
    expect(isUnassigned(task({ assignee: null, status: 'done' }))).toBe(false);
  });
});

describe('getAttention', () => {
  it('counts overdue, due-today and unassigned in a single pass', () => {
    const counts = getAttention([
      task({ _id: 'a', dueDate: inDays(-2) }),
      task({ _id: 'b', dueDate: inDays(-1) }),
      task({ _id: 'c', dueDate: inDays(0) }),
      task({ _id: 'd', assignee: null }),
      task({ _id: 'e', dueDate: inDays(30) }),
    ]);

    expect(counts).toEqual({ overdue: 2, today: 1, unassigned: 1 });
  });

  it('lets one task count in two categories at once', () => {
    const counts = getAttention([task({ dueDate: inDays(-1), assignee: null })]);

    expect(counts.overdue).toBe(1);
    expect(counts.unassigned).toBe(1);
  });

  it('returns zeroes rather than throwing for an empty or missing board', () => {
    expect(getAttention(null)).toEqual({ overdue: 0, today: 0, unassigned: 0 });
  });
});

describe('matchesAttention', () => {
  it('passes everything through when no filter is active', () => {
    expect(matchesAttention(task(), null)).toBe(true);
  });

  it('matches the overdue filter', () => {
    expect(matchesAttention(task({ dueDate: inDays(-1) }), 'overdue')).toBe(true);
    expect(matchesAttention(task({ dueDate: inDays(5) }), 'overdue')).toBe(false);
  });

  it('matches the unassigned filter', () => {
    expect(matchesAttention(task({ assignee: null }), 'unassigned')).toBe(true);
    expect(matchesAttention(task(), 'unassigned')).toBe(false);
  });
});

describe('taskRef', () => {
  it('derives a short reference from the real id', () => {
    expect(taskRef('65f1a2b3c4d5e6f7a8b94f2a')).toBe('TASK-4F2A');
  });

  it('degrades gracefully rather than throwing on a bad id', () => {
    expect(taskRef(null)).toBe('TASK-????');
    expect(taskRef('ab')).toBe('TASK-????');
  });
});
