import { useContext, useState } from 'react';
import { Menu } from '@headlessui/react';
import { MoreHorizontal } from 'lucide-react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';

import { Button, Modal, Text, Badge, Avatar } from '../../../../components/ui';
import useModal from '../../../../hooks/useModal';
import { TasksContext } from '../../../../store/TaskProvider';
import { TASK_STATUSES, TASK_PRIORITIES } from '../../../../constants/task';
import CheckLists from '../ChecklistsContainer/Checklists';
import TaskForm from '../TaskForm/TaskForm';
import copyLink from '../../../../utils/copyLink';
import getFormattedDate from '../../../../utils/getFormatedDate';

import styles from './Card.module.css';

export default function Card({ task, isOpen, toggleDisclosure }) {
  const { minorTaskUpdate, deleteTask } = useContext(TasksContext);
  const { isOpen: deleteIsOpen, toggleModal: toggleDeleteModal } = useModal();
  const { isOpen: editIsOpen, toggleModal: toggleEditModal } = useModal();
  const [isDeleting, setIsDeleting] = useState(false);

  const priority =
    TASK_PRIORITIES.find((item) => item.value === task.priority) ?? TASK_PRIORITIES[2];

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

  const dueDateVariant = () => {
    if (task.status === 'done') return 'success';
    return task.isExpired ? 'error' : 'default';
  };

  return (
    <>
      <article className={styles.container}>
        <div className={styles.topRow}>
          <Text as="span" step={1} weight="500" className={styles.priority}>
            {/* The colour dot alone would encode priority by colour only; the
                text label carries the same information. */}
            <span
              className={styles.dot}
              style={{ background: priority.color }}
              aria-hidden="true"
            />
            {priority.label}
          </Text>

          <div className={styles.topRowEnd}>
            <Avatar email={task.assignee} size="sm" />

            <Menu as="div" className={styles.menu}>
              <Menu.Button className={styles.menuButton} aria-label="Task actions">
                <MoreHorizontal size={18} />
              </Menu.Button>

              <Menu.Items className={styles.menuItems}>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={toggleEditModal}
                      className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
                    >
                      Edit
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
                      Share
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
                      Delete
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

        <CheckLists
          isOpen={isOpen}
          toggleDisclosure={toggleDisclosure}
          task={task}
          checklists={task.checklists}
        />

        <div className={styles.footer}>
          {task.dueDate && (
            <Badge variant={dueDateVariant()}>
              {getFormattedDate(new Date(task.dueDate))}
            </Badge>
          )}

          <div className={styles.statusBadges}>
            {TASK_STATUSES.filter((status) => status.value !== task.status).map((status) => (
              <Badge
                key={status.value}
                onClick={() => handleStatusChange(status.value)}
                label={`Move "${task.title}" to ${status.title}`}
              >
                {status.title}
              </Badge>
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
              <Button
                variant="outline"
                onClick={toggleDeleteModal}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button color="error" onClick={handleTaskDelete} disabled={isDeleting}>
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
