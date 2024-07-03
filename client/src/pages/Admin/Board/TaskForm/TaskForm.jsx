import React, { useState, useContext } from 'react';
import { useImmer } from 'use-immer';
import { v4 as uuidv4 } from 'uuid';
import { RadioGroup } from '@headlessui/react';
import { Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';

import { Button, Text } from '../../../../components/ui';
import Dropdown from '../../../../components/form/SearchableDropdown/Dropdown';
import { TasksContext } from '../../../../store/TaskProvider';
import Datepicker from '../../../../components/form/DatePicker/DatePicker'; 

import styles from './TaskForm.module.css';

const dummyTask = {
  title: '',
  checklists: [],
  priority: 'high',
  assignee: '',
  dueDate: null, 
};

const TaskForm = ({ defaultTask = dummyTask, toggleModal, action = 'add' }) => {
  const [task, setTask] = useImmer(defaultTask);
  const { majorTaskUpdate, addTask } = useContext(TasksContext);
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false); 
  const [selectedDate, setSelectedDate] = useState(task.dueDate ? new Date(task.dueDate) : null); 

  const currentAssignee = task.assignee;

  const handleAddTask = async () => {
    if (!task.title.trim()) {
      toast.error('Title cannot be empty!');
      return;
    }

    setIsLoading(true);
    try {
      await addTask(task);
      toggleModal();
      toast.success('Successfully added task!');
    } catch (err) {
      console.log(err.message);
      toast.error(err.message);
    }
    setIsLoading(false);
  };

  const handleUpdateTask = async () => {
    if (!task.title.trim()) {
      toast.error('Title cannot be empty!');
      return;
    }

    setIsLoading(true);
    try {
      await majorTaskUpdate(task._id, task);
      toggleModal();
      toast.success('Successfully updated task!');
    } catch (err) {
      toast.error(err.message);
    }
    setIsLoading(false);
  };

  const updateTitle = (value) => {
    setTask((draft) => {
      draft.title = value;
    });
  };

  const changePriority = (priority) => {
    setTask((draft) => {
      draft.priority = priority;
    });
  };

  const updateAssignee = (selectedOption) => {
    const value = selectedOption ? selectedOption.value : '';
    setTask((draft) => {
      draft.assignee = value;
    });
  };

  const addList = () => {
    setTask((draft) => {
      draft.checklists.push({
        checked: false,
        title: '',
        _id: uuidv4(),
        isNew: true,
      });
    });
  };

  const deleteList = (id) => {
    setTask((draft) => {
      draft.checklists = draft.checklists.filter((list) => list._id !== id);
    });
  };

  const updateListChecked = (listId, value) => {
    setTask((draft) => {
      let list = draft.checklists.find((list) => list._id === listId);

      if (!list) return;

      list.checked = value;
    });
  };

  const updateListTitle = (listId, value) => {
    setTask((draft) => {
      let list = draft.checklists.find((list) => list._id === listId);

      if (!list) return;

      list.title = value;
    });
  };

  const updateDate = (date) => {
    setTask((draft) => {
      draft.dueDate = date || null; 
    });
    setSelectedDate(date); 
    setShowDatePicker(false); 
  };

  const dones = task?.checklists.filter((list) => list.checked);

  return (
    <div className={styles.container}>
      <div className={styles.input}>
        <label htmlFor="taskTitle">
          Title <span style={{ color: 'red' }}>*</span>
        </label>
        <input
          placeholder="Enter Task Title"
          type="text"
          id="taskTitle"
          value={task.title}
          onChange={(e) => updateTitle(e.target.value)}
        />
      </div>

      <div className={styles.input2}>
        <label htmlFor="assigneeDropdown" className={styles.label}>
          Assign to
        </label>
        <div className={styles.dropdown}>
          <Dropdown
            id="assigneeDropdown"
            onChange={(selectedOption) => updateAssignee(selectedOption)}
            assignedValue={currentAssignee}
          />
        </div>
      </div>

      <RadioGroup
        className={styles.radioGroup}
        value={task.priority}
        onChange={changePriority}
      >
        <RadioGroup.Label>
          Select Priority <span style={{ color: 'red' }}>*</span>
        </RadioGroup.Label>

        <div className={styles.radioOptions}>
          <RadioGroup.Option value="high">
            {({ checked }) => (
              <div
                className={` ${checked && styles.checkedOption} ${
                  styles.radioOption
                }`}
              >
                <Text step={1}>
                  <span style={{ color: '#ff2473' }}>•</span> HIGH PRIORITY
                </Text>
              </div>
            )}
          </RadioGroup.Option>
          <RadioGroup.Option value="moderate">
            {({ checked }) => (
              <div
                className={` ${checked && styles.checkedOption} ${
                  styles.radioOption
                }`}
              >
                <Text step={1}>
                  <span style={{ color: '#18b0ff' }}>•</span> MODERATE PRIORITY
                </Text>
              </div>
            )}
          </RadioGroup.Option>
          <RadioGroup.Option value="low">
            {({ checked }) => (
              <div
                className={` ${checked && styles.checkedOption} ${
                  styles.radioOption
                }`}
              >
                <Text step={1}>
                  <span style={{ color: '#63c05b' }}>•</span> LOW PRIORITY
                </Text>
              </div>
            )}
          </RadioGroup.Option>
        </div>
      </RadioGroup>

      <div className={styles.checklists}>
        <Text>
          Checklist (
          {(dones.length ?? 0) + '/' + (task?.checklists.length ?? 0)}){' '}
          <span style={{ color: 'red' }}>*</span>
        </Text>

        <div className={styles.lists}>
          {task?.checklists.map((list) => (
            <div className={styles.list} key={list._id}>
              <input
                type="checkbox"
                name=""
                id=""
                checked={list.checked}
                onChange={(e) => updateListChecked(list._id, e.target.checked)}
              />
              <input
                type="text"
                value={list.title}
                onChange={(e) => updateListTitle(list._id, e.target.value)}
              />
              <button onClick={() => deleteList(list._id)} type="button">
                <Trash2 size={20} />
              </button>
            </div>
          ))}
        </div>

        <div className={styles.addButton}>
          <Button onClick={addList} variant="ghost">
            + Add New
          </Button>
        </div>
      </div>

      <div className={styles.buttonGroup}>
        <Button
          onClick={() => setShowDatePicker(!showDatePicker)}
          variant="jumbo" color='neutral'
        >
          {selectedDate ? (
            `${new Date(selectedDate).toLocaleDateString()}`
          ) : (
            'Select Due Date'
          )}
        </Button>
        {showDatePicker && (
          <div className={styles.datePickerContainer}>
            <Datepicker
              selectedDate={task.dueDate}
              onDateChange={updateDate}
            />
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="outline" color="error" onClick={toggleModal}>
            Cancel
          </Button>
          <Button onClick={action === 'add' ? handleAddTask : handleUpdateTask}>
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
};

TaskForm.propTypes = {
  defaultTask: PropTypes.object,
  toggleModal: PropTypes.func,
  action: PropTypes.oneOf(['add', 'update']),
};

export default TaskForm;
