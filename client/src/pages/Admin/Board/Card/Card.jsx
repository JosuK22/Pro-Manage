import { useContext, useMemo, useState } from 'react';
import { Menu } from '@headlessui/react';
import { useDraggable } from '@dnd-kit/core';
import { AlertTriangle, Clock, GripVertical, MoreHorizontal } from 'lucide-react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';

import { Button, Modal, Text, Avatar } from '../../../../components/ui';
import useModal from '../../../../hooks/useModal';
import { TasksContext } from '../../../../store/TaskProvider';
import { TASK_STATUSES, TASK_PRIORITIES } from '../../../../constants/task';
import { URGENCY, getUrgency, taskRef } from '../../../../utils/taskUrgency';
import CheckLists from '../ChecklistsContainer/Checklists';
import TaskForm from '../TaskForm/TaskForm';
import copyLink from '../../../../utils/copyLink';
import getFormattedDate from '../../../../utils/getFormatedDate';

import styles from './Card.module.css';

/** Urgency levels that earn a visible flag on the card. */
const FLAGGED = {
  [URGENCY.OVERDUE]: { icon: AlertTriangle, tone: 'overdue' },
  [URGENCY.TODAY]: { icon: Clock, tone: 'today' },
  [URGENCY.SOON]: { icon: Clock, tone: 'soon' },
};

export default function Card({ task, isOpen, toggleDisclosure }) {
  const { minorTaskUpdate, deleteTask } = useContext(TasksContext);
  const { isOpen: deleteIsOpen, toggleModal: toggleDeleteModal } = useModal();
  const { isOpen: editIsOpen, toggleModal: toggleEditModal } = useModal();
  const [isDeleting, setIsDeleting] = useState(false);

  const priority =
    TASK_PRIORITIES.find((item) => item.value === task.priority) ?? TASK_PRIORITIES[2];

  const urgency = getUrgency(task);
  const flag = FLAGGED[urgency.level];

  const progress = useMemo(() => {
    const items = task.checklists ?? [];
    const done = items.filter((item) => item.checked).length;
    return {
      done,
      total: items.length,
      percent: items.length ? Math.round((done / items.length) * 100) : 0,
    };
  }, [task.checklists]);

  /**
   * Drag-and-drop is an *enhancement*: the status buttons below remain the
   * primary, always-available way to move a task. Only the grip handle carries
   * the drag listeners, so clicking the menu, the checklist or a badge is never
   * swallowed by a drag gesture.
   */
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: task._id,
    data: { task },
  });

  // `deleteTask` is async: without `await`, the try/catch could never observe a
  // rejection, so a failed delete still closed the modal and claimed success.
  const handleTaskDelete = async () => {
    if (isDeleting) return;

    setIsDeleting(true);
    try {
      await deleteTask(task._id);
      toggleDeleteModal();
      toast.success('Task deleted');
    } catch (err) {
      if (!err.isSessionExpired) toast.error(err.message || 'Could not delete this task.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStatusChange = async (status) => {
    try {
      await minorTaskUpdate(task, { status });
    } catch (err) {
      // The provider has already rolled the board back to its previous state.
      if (!err.isSessionExpired) toast.error(err.message || 'Could not move this task.');
    }
  };

  return (
    <>
      <article
        ref={setNodeRef}
        className={[
          styles.container,
          isDragging ? styles.dragging : '',
          urgency.level === URGENCY.OVERDUE ? styles.isOverdue : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* --- Ticket header: priority left, reference right ------------- */}
        <div className={styles.topRow}>
          <span className={`${styles.priority} ${styles[priority.value]}`}>
            {/* The dot is a redundant cue — the label carries the same
                information for anyone who cannot separate the colours. */}
            <span
              className={styles.dot}
              style={{ background: priority.color }}
              aria-hidden="true"
            />
            {priority.shortLabel}
          </span>

          <div className={styles.topRowEnd}>
            <span className={styles.ref} aria-hidden="true">
              {taskRef(task._id)}
            </span>

            {/* dnd-kit's `attributes` add the aria-describedby that tells screen
                reader users how to pick the card up with the keyboard. */}
            <button
              type="button"
              ref={setActivatorNodeRef}
              className={styles.dragHandle}
              aria-label={`Move “${task.title}”`}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={15} aria-hidden="true" />
            </button>

            <Menu as="div" className={styles.menu}>
              <Menu.Button className={styles.menuButton} aria-label={`Actions for “${task.title}”`}>
                <MoreHorizontal size={17} />
              </Menu.Button>

              <Menu.Items className={styles.menuItems}>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={toggleEditModal}
                      className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
                    >
                      Edit task
                    </button>
                  )}
                </Menu.Item>

                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={() => copyLink(task._id)}
                      className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
                    >
                      Copy share link
                    </button>
                  )}
                </Menu.Item>

                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={toggleDeleteModal}
                      className={`${styles.menuItem} ${styles.menuItemDanger} ${
                        active ? styles.menuItemActive : ''
                      }`}
                    >
                      Delete task
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Menu>
          </div>
        </div>

        {/* Long titles clamp to two lines with the full text available via
            `title`, instead of being cut at a fixed 150px width. */}
        <h4 className={styles.title} title={task.title}>
          {task.title}
        </h4>

        {/* --- Checklist progress ---------------------------------------
            Always visible, so the card answers "how far along is this?"
            without being expanded. */}
        {progress.total > 0 && (
          <div className={styles.progress}>
            <span
              className={styles.meter}
              role="img"
              aria-label={`Checklist ${progress.done} of ${progress.total} complete`}
            >
              <span className={styles.meterFill} style={{ width: `${progress.percent}%` }} />
            </span>
            <span className={styles.progressCount} aria-hidden="true">
              {progress.done}/{progress.total}
            </span>
          </div>
        )}

        <CheckLists
          isOpen={isOpen}
          toggleDisclosure={toggleDisclosure}
          task={task}
          checklists={task.checklists}
        />

        {/* --- Assignee and deadline ------------------------------------- */}
        <div className={styles.meta}>
          <span className={styles.assignee}>
            <Avatar email={task.assignee} size="sm" />
            <span className={styles.assigneeName}>
              {task.assignee || 'Unassigned'}
            </span>
          </span>

          {task.dueDate && (
            <span className={`${styles.due} ${flag ? styles[flag.tone] : ''}`}>
              {flag && <flag.icon size={13} aria-hidden="true" />}
              <span>{urgency.label || getFormattedDate(new Date(task.dueDate))}</span>
            </span>
          )}
        </div>

        {/* --- Move controls ---------------------------------------------
            Labelled explicitly so the user knows what the buttons do before
            clicking, and so they work as the accessible alternative to drag. */}
        <div className={styles.moveRow}>
          <span className={styles.moveLabel} aria-hidden="true">
            Move to
          </span>

          <div className={styles.statusButtons}>
            {TASK_STATUSES.filter((status) => status.value !== task.status).map((status) => (
              <button
                key={status.value}
                type="button"
                className={styles.statusButton}
                onClick={() => handleStatusChange(status.value)}
                aria-label={`Move “${task.title}” to ${status.title}`}
              >
                {status.title}
              </button>
            ))}
          </div>
        </div>
      </article>

      {deleteIsOpen && (
        <Modal toggleModal={toggleDeleteModal} title="Delete task" size="sm">
          <div className={styles.dialogBody}>
            <Text>
              Delete <strong>“{task.title}”</strong>? This action cannot be undone.
            </Text>

            <div className={styles.dialogActions}>
              <Button variant="outline" onClick={toggleDeleteModal} disabled={isDeleting}>
                Cancel
              </Button>
              <Button color="error" onClick={handleTaskDelete} loading={isDeleting}>
                {isDeleting ? 'Deleting…' : 'Delete task'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {editIsOpen && (
        <Modal toggleModal={toggleEditModal} title="Edit task" size="lg">
          <TaskForm defaultTask={task} action="update" toggleModal={toggleEditModal} />
        </Modal>
      )}
    </>
  );
}

Card.propTypes = {
  task: PropTypes.object.isRequired,
  isOpen: PropTypes.bool.isRequired,
  toggleDisclosure: PropTypes.func.isRequired,
};
