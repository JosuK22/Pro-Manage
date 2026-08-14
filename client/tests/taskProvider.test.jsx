import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContext } from 'react';

import TaskProvider, { TasksContext } from '../src/store/TaskProvider';
import { AuthContext } from '../src/store/AuthProvider';
import { taskApi } from '../src/services';

vi.mock('../src/services', () => ({
  taskApi: {
    list: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    analytics: vi.fn(),
  },
}));

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

/** Minimal consumer that surfaces provider state and actions to the test. */
function Harness() {
  const { tasks, isLoading, error, minorTaskUpdate, deleteTask } = useContext(TasksContext);

  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ? error.message : 'none'}</span>
      <ul>
        {(tasks ?? []).map((item) => (
          <li key={item._id} data-testid="task">
            {item.title} — {item.status}
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => minorTaskUpdate(task(), { status: 'done' })}>
        Move to done
      </button>
      <button type="button" onClick={() => deleteTask('t1')}>
        Delete
      </button>
    </div>
  );
}

const renderProvider = () =>
  render(
    <AuthContext.Provider value={{ isAuthenticated: true, user: { token: 'tok' } }}>
      <TaskProvider>
        <Harness />
      </TaskProvider>
    </AuthContext.Provider>
  );

describe('TaskProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskApi.list.mockResolvedValue({ data: { tasks: [task()] } });
  });

  it('loads the board on mount', async () => {
    renderProvider();

    expect(await screen.findByText('Prepare report — todo')).toBeInTheDocument();
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('exposes a load failure as error state rather than throwing', async () => {
    taskApi.list.mockRejectedValue(new Error('Network down'));

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('Network down')
    );
  });

  it('does not set error state when the session expired (handled centrally)', async () => {
    const expired = new Error('Session expired');
    expired.isSessionExpired = true;
    taskApi.list.mockRejectedValue(expired);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('applies a status change optimistically and keeps the server’s version', async () => {
    taskApi.update.mockResolvedValue({ data: { task: task({ status: 'done' }) } });

    renderProvider();
    await screen.findByText('Prepare report — todo');

    await userEvent.click(screen.getByRole('button', { name: 'Move to done' }));

    await waitFor(() =>
      expect(screen.getByText('Prepare report — done')).toBeInTheDocument()
    );
  });

  // The defect this guards: the board used to keep showing a state the server
  // had rejected, until the user manually refreshed.
  it('rolls the board back when the server rejects an update', async () => {
    taskApi.update.mockRejectedValue(new Error('Task not found'));

    renderProvider();
    await screen.findByText('Prepare report — todo');

    await userEvent.click(screen.getByRole('button', { name: 'Move to done' }));

    await waitFor(() =>
      expect(screen.getByText('Prepare report — todo')).toBeInTheDocument()
    );
    expect(screen.queryByText('Prepare report — done')).not.toBeInTheDocument();
  });

  it('removes a task optimistically on delete', async () => {
    taskApi.remove.mockResolvedValue(null);

    renderProvider();
    await screen.findByText('Prepare report — todo');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryAllByTestId('task')).toHaveLength(0));
  });

  it('restores a deleted task when the server rejects the delete', async () => {
    taskApi.remove.mockRejectedValue(new Error('Task not found'));

    renderProvider();
    await screen.findByText('Prepare report — todo');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.getByText('Prepare report — todo')).toBeInTheDocument()
    );
  });
});
