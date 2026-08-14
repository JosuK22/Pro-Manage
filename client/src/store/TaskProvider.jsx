import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import PropTypes from 'prop-types';
import { useImmer } from 'use-immer';

import { AuthContext } from './AuthProvider';
import { taskApi } from '../services';
import { DEFAULT_DATE_RANGE } from '../constants/task';

export const TasksContext = createContext({
  tasks: null,
  isLoading: false,
  error: null,
  selectedDateRange: DEFAULT_DATE_RANGE,
  setSelectedDateRange: () => {},
  fetchTasks: async () => {},
  minorTaskUpdate: async () => {},
  majorTaskUpdate: async () => {},
  addTask: async () => {},
  deleteTask: async () => {},
});

/** Strip client-only checklist bookkeeping before sending a task to the API. */
const toApiPayload = (task) => ({
  title: task.title,
  priority: task.priority,
  status: task.status,
  dueDate: task.dueDate ?? null,
  assignee: task.assignee || null,
  checklists: (task.checklists ?? []).map((list) => ({
    title: list.title,
    checked: Boolean(list.checked),
  })),
});

export default function TaskProvider({ children }) {
  const [tasks, setTasks] = useImmer(null);
  const [selectedDateRange, setSelectedDateRange] = useState(DEFAULT_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const { isAuthenticated } = useContext(AuthContext);
  const { value: range } = selectedDateRange;

  // Lets a mutation snapshot the current list without taking a dependency on
  // `tasks`, which would rebuild every callback on each keystroke of state.
  const tasksRef = useRef(null);
  tasksRef.current = tasks;

  const fetchTasks = useCallback(
    async ({ signal } = {}) => {
      if (!isAuthenticated) return;

      setIsLoading(true);
      setError(null);

      try {
        const res = await taskApi.list({ range, signal });
        setTasks(res.data.tasks);
      } catch (err) {
        if (err.name === 'AbortError') return;

        // A dead session is already being handled centrally (one toast, one
        // redirect); surfacing a board-level error on top would be noise.
        if (!err.isSessionExpired) {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [isAuthenticated, range, setTasks]
  );

  useEffect(() => {
    const controller = new AbortController();

    fetchTasks({ signal: controller.signal });

    // Cancels an in-flight board load when the range changes again quickly, so
    // a slow earlier response cannot overwrite a newer one.
    return () => controller.abort();
  }, [fetchTasks]);

  /**
   * Apply an optimistic change, then reconcile with the server.
   *
   * The previous implementation mutated local state and fired the request
   * without ever restoring the old value, so a rejected update stayed on
   * screen until a manual refresh — the UI showed a state the server had
   * refused.
   */
  const withOptimisticUpdate = useCallback(
    async (applyLocally, sendToServer) => {
      const previous = tasksRef.current;

      setTasks(applyLocally);

      try {
        return await sendToServer();
      } catch (err) {
        // Restore the exact pre-change list.
        setTasks(previous);
        throw err;
      }
    },
    [setTasks]
  );

  /** Small in-place edits: status change, checklist tick. */
  const minorTaskUpdate = useCallback(
    async (task, updates) =>
      withOptimisticUpdate(
        (draft) => {
          if (!draft) return;
          const target = draft.find((item) => item._id === task._id);
          if (!target) return;

          Object.entries(updates).forEach(([key, value]) => {
            target[key] = value;
          });
        },
        async () => {
          const res = await taskApi.update(task._id, updates);

          // Adopt the server's version so derived fields the server owns
          // (completedAt, isExpired, assignedTo) are correct locally too.
          setTasks((draft) => {
            if (!draft) return;
            const index = draft.findIndex((item) => item._id === task._id);
            if (index >= 0) draft[index] = res.data.task;
          });
        }
      ),
    [withOptimisticUpdate, setTasks]
  );

  /**
   * Full task edits from the form.
   *
   * Not optimistic: the server normalises the checklist (assigning real ids)
   * and resolves the assignee, so rendering a guess would flash the wrong
   * content. The form shows its own submitting state instead.
   */
  const majorTaskUpdate = useCallback(
    async (taskId, updates) => {
      const res = await taskApi.update(taskId, toApiPayload(updates));

      setTasks((draft) => {
        if (!draft) return;
        const index = draft.findIndex((task) => task._id === taskId);
        if (index >= 0) draft[index] = res.data.task;
      });

      return res.data.task;
    },
    [setTasks]
  );

  const addTask = useCallback(
    async (task) => {
      const res = await taskApi.create(toApiPayload(task));

      setTasks((draft) => {
        // Newest first, matching the server's sort.
        if (draft) draft.unshift(res.data.task);
        else return [res.data.task];
      });

      return res.data.task;
    },
    [setTasks]
  );

  const deleteTask = useCallback(
    async (taskId) =>
      withOptimisticUpdate(
        (draft) => {
          if (!draft) return;
          return draft.filter((task) => task._id !== taskId);
        },
        () => taskApi.remove(taskId)
      ),
    [withOptimisticUpdate]
  );

  const value = useMemo(
    () => ({
      tasks,
      isLoading,
      error,
      selectedDateRange,
      setSelectedDateRange,
      fetchTasks,
      minorTaskUpdate,
      majorTaskUpdate,
      addTask,
      deleteTask,
    }),
    [
      tasks,
      isLoading,
      error,
      selectedDateRange,
      fetchTasks,
      minorTaskUpdate,
      majorTaskUpdate,
      addTask,
      deleteTask,
    ]
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

TaskProvider.propTypes = {
  children: PropTypes.node,
};
