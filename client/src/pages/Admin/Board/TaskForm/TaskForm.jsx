import { useState, useContext, useId } from 'react';
import { useImmer } from 'use-immer';
import { RadioGroup } from '@headlessui/react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';

import { Button, IconButton } from '../../../../components/ui';
import Dropdown from '../../../../components/form/SearchableDropdown/Dropdown';
import { TasksContext } from '../../../../store/TaskProvider';
import Datepicker from '../../../../components/form/DatePicker/DatePicker';
import { TASK_PRIORITIES } from '../../../../constants/task';
import getFormattedDate from '../../../../utils/getFormatedDate';
import newTempId from '../../../../utils/newTempId';

import styles from './TaskForm.module.css';

/**
 * A new task starts with one blank checklist row already present.
 *
 * The API requires at least one item, so every "quick" task used to cost an
 * extra click on "+ Add item" before it could be saved at all. Starting with
 * the row satisfies the requirement without the user having to discover it.
 */
const makeEmptyTask = () => ({
  title: '',
  checklists: [{ checked: false, title: '', _id: newTempId(), isNew: true }],
  priority: 'high',
  assignee: '',
  dueDate: null,
});

export default function TaskForm({ defaultTask, toggleModal, action = 'add' }) {
  const [task, setTask] = useImmer(defaultTask ?? makeEmptyTask);
  const { majorTaskUpdate, addTask } = useContext(TasksContext);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [showDatePicker, setShowDatePicker] = useState(false);

  const titleId = useId();
  const assigneeId = useId();

  const isEditing = action === 'update';

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
      if (isEditing) {
        await majorTaskUpdate(task._id, task);
        toast.success('Changes saved');
      } else {
        await addTask(task);
        toast.success('Task created');
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
      draft.checklists.push({ checked: false, title: '', _id: newTempId(), isNew: true });
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

  const doneCount = task.checklists.filter((list) => list.checked).length;
  const total = task.checklists.length;
  const percent = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.scrollArea}>
        {/* --- The one question that matters ---------------------------- */}
        <div className={styles.field}>
          <label htmlFor={titleId} className={styles.primaryLabel}>
            What needs to be done?
            <span className="srOnly">(required)</span>
          </label>
          <input
            id={titleId}
            type="text"
            className={styles.titleInput}
            placeholder="e.g. Prepare project report"
            value={task.title}
            /* Autofocus is right here: the dialog exists to capture this. */
            autoFocus
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

        {/* --- Priority ------------------------------------------------- */}
        <RadioGroup value={task.priority} onChange={changePriority} className={styles.field}>
          <RadioGroup.Label className={styles.sectionLabel}>Priority</RadioGroup.Label>

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
                    {priority.shortLabel}
                  </span>
                )}
              </RadioGroup.Option>
            ))}
          </div>
        </RadioGroup>

        {/* --- Who and when --------------------------------------------- */}
        <div className={styles.metaRow}>
          <div className={styles.field}>
            <label htmlFor={assigneeId} className={styles.sectionLabel}>
              Assign to
            </label>
            <Dropdown id={assigneeId} onChange={updateAssignee} assignedValue={task.assignee} />
          </div>

          <div className={styles.field}>
            <span className={styles.sectionLabel} id={`${titleId}-due`}>
              Due date
            </span>

            <div className={styles.dueDateGroup}>
              <Button
                variant="outline"
                className={styles.dueButton}
                onClick={() => setShowDatePicker((open) => !open)}
                aria-expanded={showDatePicker}
                aria-describedby={`${titleId}-due`}
              >
                <CalendarDays size={16} aria-hidden="true" />
                {task.dueDate ? getFormattedDate(new Date(task.dueDate)) : 'No due date'}
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
          </div>
        </div>

        {/* --- Checklist ------------------------------------------------- */}
        <fieldset className={styles.checklists}>
          <legend className={styles.legend}>
            <span className={styles.sectionLabel}>Checklist</span>
            <span className={styles.legendCount}>
              {doneCount}/{total}
            </span>
          </legend>

          {total > 0 && (
            <span
              className={styles.meter}
              role="img"
              aria-label={`${doneCount} of ${total} items complete`}
            >
              <span className={styles.meterFill} style={{ width: `${percent}%` }} />
            </span>
          )}

          <div className={styles.lists}>
            {task.checklists.map((list, index) => (
              <div
                className={`${styles.list} ${list.checked ? styles.listDone : ''}`}
                key={list._id}
              >
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
                  /* The API requires one item, so the last row cannot go. */
                  disabled={total === 1}
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            ))}
          </div>

          {errors.checklists && (
            <p className={styles.error} role="alert">
              {errors.checklists}
            </p>
          )}

          <Button onClick={addList} variant="ghost" className={styles.addItem}>
            <Plus size={15} aria-hidden="true" />
            Add item
          </Button>
        </fieldset>
      </div>

      {/* Pinned so the primary action is always reachable, however long the
          checklist grows and however small the screen is. */}
      <div className={styles.actions}>
        <Button variant="outline" onClick={toggleModal} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? 'Save changes' : 'Create task'}
        </Button>
      </div>
    </form>
  );
}

TaskForm.propTypes = {
  defaultTask: PropTypes.object,
  toggleModal: PropTypes.func.isRequired,
  action: PropTypes.oneOf(['add', 'update']),
};
