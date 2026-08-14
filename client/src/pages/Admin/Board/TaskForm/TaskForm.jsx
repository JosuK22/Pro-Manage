import { useState, useContext, useId } from 'react';
import { useImmer } from 'use-immer';
import { v4 as uuidv4 } from 'uuid';
import { RadioGroup } from '@headlessui/react';
import { CalendarDays, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';

import { Button, Text, IconButton } from '../../../../components/ui';
import Dropdown from '../../../../components/form/SearchableDropdown/Dropdown';
import { TasksContext } from '../../../../store/TaskProvider';
import Datepicker from '../../../../components/form/DatePicker/DatePicker';
import { TASK_PRIORITIES } from '../../../../constants/task';
import getFormattedDate from '../../../../utils/getFormatedDate';

import styles from './TaskForm.module.css';

const emptyTask = {
  title: '',
  checklists: [],
  priority: 'high',
  assignee: '',
  dueDate: null,
};

export default function TaskForm({ defaultTask = emptyTask, toggleModal, action = 'add' }) {
  const [task, setTask] = useImmer(defaultTask);
  const { majorTaskUpdate, addTask } = useContext(TasksContext);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [showDatePicker, setShowDatePicker] = useState(false);

  const titleId = useId();
  const assigneeId = useId();

  const validate = () => {
    const next = {};

    if (!task.title.trim()) next.title = 'Give the task a title.';
    if (task.checklists.length === 0) next.checklists = 'Add at least one checklist item.';
    else if (task.checklists.some((list) => !list.title.trim())) {
      next.checklists = 'Every checklist item needs some text.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    // Guard against a double submit even if the disabled button is bypassed
    // (Enter key, rapid double click before the re-render lands).
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      if (action === 'add') {
        await addTask(task);
        toast.success('Task created');
      } else {
        await majorTaskUpdate(task._id, task);
        toast.success('Task updated');
      }

      toggleModal();
    } catch (err) {
      // Attach field-level messages the API returned, then report the rest.
      if (err.errors) setErrors(err.errors);
      if (!err.isSessionExpired) toast.error(err.message || 'Could not save this task.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateTitle = (value) =>
    setTask((draft) => {
      draft.title = value;
    });

  const changePriority = (priority) =>
    setTask((draft) => {
      draft.priority = priority;
    });

  const updateAssignee = (option) =>
    setTask((draft) => {
      draft.assignee = option ? option.value : '';
    });

  const addList = () =>
    setTask((draft) => {
      // `isNew` marks a client-generated id so it is stripped before sending.
      draft.checklists.push({ checked: false, title: '', _id: uuidv4(), isNew: true });
    });

  const deleteList = (id) =>
    setTask((draft) => {
      draft.checklists = draft.checklists.filter((list) => list._id !== id);
    });

  const updateListChecked = (listId, value) =>
    setTask((draft) => {
      const list = draft.checklists.find((item) => item._id === listId);
      if (list) list.checked = value;
    });

  const updateListTitle = (listId, value) =>
    setTask((draft) => {
      const list = draft.checklists.find((item) => item._id === listId);
      if (list) list.title = value;
    });

  const updateDate = (date) => {
    setTask((draft) => {
      draft.dueDate = date || null;
    });
    setShowDatePicker(false);
  };

  const dones = task.checklists.filter((list) => list.checked);

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor={titleId}>
          Title <span className={styles.required} aria-hidden="true">*</span>
          <span className="srOnly">(required)</span>
        </label>
        <input
          id={titleId}
          type="text"
          placeholder="Enter task title"
          value={task.title}
          onChange={(event) => updateTitle(event.target.value)}
          aria-invalid={errors.title ? 'true' : undefined}
          aria-describedby={errors.title ? `${titleId}-error` : undefined}
        />
        {errors.title && (
          <p id={`${titleId}-error`} className={styles.error} role="alert">
            {errors.title}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor={assigneeId}>Assign to</label>
        <Dropdown id={assigneeId} onChange={updateAssignee} assignedValue={task.assignee} />
      </div>

      <RadioGroup value={task.priority} onChange={changePriority} className={styles.field}>
        <RadioGroup.Label>
          Priority <span className={styles.required} aria-hidden="true">*</span>
        </RadioGroup.Label>

        <div className={styles.priorities}>
          {TASK_PRIORITIES.map((priority) => (
            <RadioGroup.Option
              key={priority.value}
              value={priority.value}
              className={styles.priorityOption}
            >
              {({ checked }) => (
                <span className={`${styles.priority} ${checked ? styles.priorityChecked : ''}`}>
                  <span
                    className={styles.dot}
                    style={{ background: priority.color }}
                    aria-hidden="true"
                  />
                  {priority.label}
                </span>
              )}
            </RadioGroup.Option>
          ))}
        </div>
      </RadioGroup>

      <fieldset className={styles.checklists}>
        <legend>
          Checklist ({dones.length}/{task.checklists.length}){' '}
          <span className={styles.required} aria-hidden="true">*</span>
        </legend>

        <div className={styles.lists}>
          {task.checklists.map((list, index) => (
            <div className={styles.list} key={list._id}>
              <input
                type="checkbox"
                checked={list.checked}
                onChange={(event) => updateListChecked(list._id, event.target.checked)}
                aria-label={`Mark checklist item ${index + 1} complete`}
              />
              <input
                type="text"
                value={list.title}
                placeholder="Add a checklist item"
                onChange={(event) => updateListTitle(list._id, event.target.value)}
                aria-label={`Checklist item ${index + 1}`}
              />
              <IconButton
                label={`Remove checklist item ${index + 1}`}
                size="sm"
                tone="danger"
                onClick={() => deleteList(list._id)}
              >
                <Trash2 size={18} />
              </IconButton>
            </div>
          ))}
        </div>

        {errors.checklists && (
          <p className={styles.error} role="alert">
            {errors.checklists}
          </p>
        )}

        <Button onClick={addList} variant="ghost">
          + Add new item
        </Button>
      </fieldset>

      {/* Actions stay reachable: the form body scrolls inside the modal and
          this row is pinned to the bottom of it. */}
      <div className={styles.actions}>
        <div className={styles.dueDateGroup}>
          <Button
            variant="outline"
            color="primary"
            onClick={() => setShowDatePicker((open) => !open)}
            aria-expanded={showDatePicker}
          >
            <CalendarDays size={16} aria-hidden="true" />
            {task.dueDate ? getFormattedDate(new Date(task.dueDate)) : 'Select due date'}
          </Button>

          {showDatePicker && (
            <div className={styles.datePicker}>
              <Datepicker
                selectedDate={task.dueDate ? new Date(task.dueDate) : null}
                onDateChange={updateDate}
              />
              {task.dueDate && (
                <Button variant="ghost" onClick={() => updateDate(null)}>
                  Clear due date
                </Button>
              )}
            </div>
          )}
        </div>

        <div className={styles.submitGroup}>
          <Button variant="outline" color="error" onClick={toggleModal} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <Text as="p" step={1} color="var(--text-muted)">
        <span aria-hidden="true">*</span> Required fields
      </Text>
    </form>
  );
}

TaskForm.propTypes = {
  defaultTask: PropTypes.object,
  toggleModal: PropTypes.func.isRequired,
  action: PropTypes.oneOf(['add', 'update']),
};
