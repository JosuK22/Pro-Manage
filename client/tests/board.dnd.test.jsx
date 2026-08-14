import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TasksContainer from '../src/pages/Admin/Board/TaskContainer/TasksContainer';
import { TasksContext } from '../src/store/TaskProvider';
import { TASK_STATUSES } from '../src/constants/task';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const task = (overrides = {}) => ({
  _id: 't1',
  title: 'Prepare report',
  status: 'todo',
  priority: 'high',
  assignee: null,
  dueDate: null,
  checklists: [],
  ...overrides,
});

const minorTaskUpdate = vi.fn();

const renderBoard = (tasks = [task()]) =>
  render(
    <TasksContext.Provider
      value={{
        isLoading: false,
        error: null,
        fetchTasks: vi.fn(),
        minorTaskUpdate,
        deleteTask: vi.fn(),
      }}
    >
      <TasksContainer
        tasks={tasks}
        hasActiveFilters={false}
        onClearFilters={vi.fn()}
        onCreateTask={vi.fn()}
      />
    </TasksContext.Provider>
  );

describe('Board drag-and-drop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    minorTaskUpdate.mockResolvedValue(undefined);
  });

  it('gives every card a drag handle with an accessible name', () => {
    renderBoard();

    expect(
      screen.getByRole('button', { name: 'Move “Prepare report”' })
    ).toBeInTheDocument();
  });

  // Stage 9's hard requirement: drag-and-drop is additive. If the grip ever
  // becomes the only way to move a task, keyboard and touch users lose the
  // feature entirely.
  it('keeps the status badges as an accessible fallback for every other column', () => {
    renderBoard();

    const others = TASK_STATUSES.filter((status) => status.value !== 'todo');

    others.forEach((status) => {
      expect(
        screen.getByRole('button', { name: `Move “Prepare report” to ${status.title}` })
      ).toBeInTheDocument();
    });

    // ...and not one pointing at the column it is already in.
    expect(
      screen.queryByRole('button', { name: 'Move “Prepare report” to To do' })
    ).not.toBeInTheDocument();
  });

  it('moves a task through the badge fallback without any drag gesture', async () => {
    renderBoard();

    await userEvent.click(
      screen.getByRole('button', { name: 'Move “Prepare report” to Done' })
    );

    expect(minorTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 't1' }),
      { status: 'done' }
    );
  });

  it('exposes each column as a labelled region so a drop target is announced', () => {
    renderBoard();

    TASK_STATUSES.forEach((status) => {
      expect(
        screen.getByRole('region', { name: `${status.title} tasks` })
      ).toBeInTheDocument();
    });
  });

  it('renders each task in the column matching its status', () => {
    renderBoard([task(), task({ _id: 't2', title: 'Ship release', status: 'done' })]);

    const done = screen.getByRole('region', { name: 'Done tasks' });
    const todo = screen.getByRole('region', { name: 'To do tasks' });

    expect(within(done).getByText('Ship release')).toBeInTheDocument();
    expect(within(todo).getByText('Prepare report')).toBeInTheDocument();
    expect(within(done).queryByText('Prepare report')).not.toBeInTheDocument();
  });
});
