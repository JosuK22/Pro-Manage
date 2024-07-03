import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';
import { useImmer } from 'use-immer';

import { AuthContext } from './AuthProvider';
import { BACKEND_URL } from '../utils/connection';

const options = [
  { id: 1, name: 'Today', value: 1 },
  { id: 2, name: 'This week', value: 7 },
  { id: 3, name: 'This month', value: 30 },
];

export const TasksContext = createContext({
  tasks: [],
  isLoading: false,
  selectedDateRange: { id: 2, name: 'This week', value: 7 },
  setSelectedDateRange: () => {},
  fetchTasks: async () => {},
  minorTaskUpdate: async () => {},
  majorTaskUpdate: async () => {},
  addTask: async () => {},
  deleteTask: async () => {},
});

export default function TaskProvider({ children }) {
  const [tasks, setTasks] = useImmer(null);
  const [selectedDateRange, setSelectedDateRange] = useState(options[1]);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useContext(AuthContext);
  const { token } = user;
  const { value } = selectedDateRange;

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        BACKEND_URL + '/api/v1/tasks?range=' + value,
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + token,
          },
        }
      );

      if (!res.ok) {
        const errObj = await res.json();
        console.log(errObj);
        throw new Error(errObj.message);
      }

      const dataObj = await res.json();
      setTasks(dataObj.data.tasks);
    } catch (error) {
      toast.error(error.message);
    }
    setIsLoading(false);
  }, [token, setTasks, value]);

  useEffect(() => {
    (async () => {
      fetchTasks();
    })();
  }, [fetchTasks]);


  const minorDbUpdate = useCallback(
    async (task, updates) => {
      const res = await fetch(
        BACKEND_URL + '/api/v1/tasks/' + task._id,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
        }
      );

      if (!res.ok) {
        const errObj = await res.json();
        console.log(errObj);
        throw new Error(errObj.message);
      }
    },
    [token]
  );

  const minorStateUpdate = useCallback(
    (task, updates) => {
      setTasks((draft) => {
        let tsk = draft.find((t) => t._id == task._id);

        if (!tsk) return;

        const updateKeys = Object.keys(updates);
        updateKeys.map((updateKey) => (tsk[updateKey] = updates[updateKey]));
      });
    },
    [setTasks]
  );

  const minorTaskUpdate = useCallback(
    async (task, updates) => {
      minorStateUpdate(task, updates);
      await minorDbUpdate(task, updates);
    },
    [minorStateUpdate, minorDbUpdate]
  );

  const majorDbUpdate = useCallback(
    async (taskId, updates) => {
      const copyTask = JSON.parse(JSON.stringify(updates));
      copyTask.checklists.forEach((list) => {
        if (list.isNew) {
          delete list._id;
          delete list.isNew;
        }
      });

      const res = await fetch(
        BACKEND_URL+ '/api/v1/tasks/' + taskId,
        {
          method: 'PATCH',
          body: JSON.stringify(copyTask),
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
        }
      );

      if (!res.ok) {
        const errObj = await res.json();
        throw new Error(errObj.message);
      }

      const resObj = await res.json();
      return resObj.data.task;
    },
    [token]
  );

  const majorTaskUpdate = useCallback(
    async (taskId, updates) => {
      const updatedTask = await majorDbUpdate(taskId, updates);
      setTasks((draft) => {
        let index = draft.findIndex((task) => task._id === taskId);
        if (index < 0) return;
        draft[index] = updatedTask;
      });
    },
    [majorDbUpdate, setTasks]
  );

  const addTaskToDb = useCallback(
    async (task) => {
      
      const copyTask = JSON.parse(JSON.stringify(task));
      copyTask.checklists.forEach((list) => {
        delete list._id;
        delete list.isNew;
      });

      const res = await fetch(BACKEND_URL + '/api/v1/tasks/', {
        method: 'POST',
        body: JSON.stringify(copyTask),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
      });

      if (!res.ok) {
        const errObj = await res.json();
        throw new Error(errObj.message);
      }

      const resObj = await res.json();
      return resObj.data.task;
    },
    [token]
  );

  const addTask = useCallback(
    async (task) => {
      const newTask = await addTaskToDb(task);

      setTasks((draft) => {
        draft.push(newTask);
      });
    },
    [setTasks, addTaskToDb]
  );


  const deleteTaskFromDb = useCallback(
    async (taskId) => {
      const res = await fetch(
        BACKEND_URL + '/api/v1/tasks/' + taskId,
        {
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer ' + token,
          },
        }
      );

      if (!res.ok) {
        const errObj = await res.json();
        throw new Error(errObj.message);
      }
    },
    [token]
  );

  const deleteTask = useCallback(
    async (taskId) => {
      await deleteTaskFromDb(taskId);

      setTasks((draft) => {
        return draft.filter((task) => task._id !== taskId);
      });
    },
    [deleteTaskFromDb, setTasks]
  );

  return (
    <TasksContext.Provider
      value={useMemo(() => {
        return {
          tasks,
          isLoading,
          minorTaskUpdate,
          fetchTasks,
          addTask,
          majorTaskUpdate,
          deleteTask,
          selectedDateRange,
          setSelectedDateRange,
        };
      }, [
        tasks,
        isLoading,
        deleteTask,
        minorTaskUpdate,
        fetchTasks,
        addTask,
        majorTaskUpdate,
        selectedDateRange,
        setSelectedDateRange,
      ])}
    >
      {children}
    </TasksContext.Provider>
  );
}

TaskProvider.propTypes = {
  children: PropTypes.node,
};
