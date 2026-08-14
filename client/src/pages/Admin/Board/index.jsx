import { useContext, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Listbox } from '@headlessui/react';
import { ChevronDown, Plus, Search, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { Text, Modal, Button, PageHeader, IconButton } from '../../../components/ui';
import { AuthContext } from '../../../store/AuthProvider';
import { TasksContext } from '../../../store/TaskProvider';
import { assigneeApi } from '../../../services';
import { DATE_RANGES, TASK_PRIORITIES } from '../../../constants/task';
import getFormattedDate from '../../../utils/getFormatedDate';
import TasksContainer from './TaskContainer/TasksContainer';
import TaskForm from './TaskForm/TaskForm';
import useModal from '../../../hooks/useModal';

import styles from './index.module.css';

export default function Board() {
  const { user } = useContext(AuthContext);
  const { tasks, selectedDateRange, setSelectedDateRange } = useContext(TasksContext);

  const { isOpen: isAddPeopleOpen, toggleModal: toggleAddPeople } = useModal();
  const { isOpen: isCreateOpen, toggleModal: toggleCreate } = useModal();

  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  /**
   * Client-side search across the fields a user would actually look for.
   * Applied once here and handed to the columns, rather than each column
   * re-scanning the full task array.
   */
  const filteredTasks = useMemo(() => {
    if (!tasks) return null;

    const term = search.trim().toLowerCase();

    return tasks.filter((task) => {
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      if (!term) return true;

      return (
        task.title?.toLowerCase().includes(term) ||
        task.assignee?.toLowerCase().includes(term) ||
        task.priority?.toLowerCase().includes(term)
      );
    });
  }, [tasks, search, priorityFilter]);

  const hasActiveFilters = Boolean(search.trim()) || priorityFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setPriorityFilter('all');
  };

  return (
    <div className={styles.container}>
      <PageHeader
        title={`Welcome, ${user?.info?.name ?? 'there'}`}
        description={getFormattedDate(new Date())}
      />

      <div className={styles.boardBar}>
        <div className={styles.boardTitleRow}>
          <Text as="h2" step={5} weight="600">
            Board
          </Text>

          {filteredTasks && (
            <Text as="span" step={2} color="var(--text-muted)">
              {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
            </Text>
          )}
        </div>

        <div className={styles.boardActions}>
          <Button variant="outline" onClick={toggleAddPeople}>
            <UserPlus size={16} aria-hidden="true" />
            Add people
          </Button>

          <Button onClick={toggleCreate}>
            <Plus size={16} aria-hidden="true" />
            Create task
          </Button>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.searchField}>
          <Search size={16} aria-hidden="true" className={styles.searchIcon} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks, assignees…"
            aria-label="Search tasks"
          />
          {search && (
            <IconButton label="Clear search" size="sm" onClick={() => setSearch('')}>
              <X size={16} />
            </IconButton>
          )}
        </div>

        <div className={styles.selects}>
          <label className={styles.selectField}>
            <span className="srOnly">Filter by priority</span>
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
            >
              <option value="all">All priorities</option>
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.shortLabel}
                </option>
              ))}
            </select>
          </label>

          <Listbox
            as="div"
            className={styles.listbox}
            value={selectedDateRange}
            onChange={setSelectedDateRange}
          >
            {({ open }) => (
              <>
                <Listbox.Button className={styles.listboxButton}>
                  {selectedDateRange?.name ?? 'Select a range'}
                  <ChevronDown size={16} className={open ? styles.rotate : ''} />
                </Listbox.Button>

                <Listbox.Options className={styles.listboxOptions}>
                  {DATE_RANGES.map((option) => (
                    <Listbox.Option key={option.id} value={option}>
                      {({ active, selected }) => (
                        <div
                          className={`${styles.listboxOption} ${
                            active ? styles.optionActive : ''
                          } ${selected ? styles.optionSelected : ''}`}
                        >
                          {option.name}
                        </div>
                      )}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
              </>
            )}
          </Listbox>
        </div>
      </div>

      <TasksContainer
        tasks={filteredTasks}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onCreateTask={toggleCreate}
      />

      {isAddPeopleOpen && <AddPeopleModal onClose={toggleAddPeople} />}

      {isCreateOpen && (
        <Modal toggleModal={toggleCreate} title="Create task" size="lg">
          <TaskForm toggleModal={toggleCreate} />
        </Modal>
      )}
    </div>
  );
}

/**
 * "Add people to the board" flow.
 *
 * Extracted from Board because it owns its own request, error and success
 * state — the previous version stored a rendered JSX tree in component state,
 * which meant the success view captured stale values and could not be styled
 * or tested independently.
 */
function AddPeopleModal({ onClose }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addedEmail, setAddedEmail] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await assigneeApi.create(email.trim());
      setAddedEmail(email.trim());
      toast.success('Member added to your board');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (addedEmail) {
    return (
      <Modal toggleModal={onClose} title="Member added" size="sm">
        <div className={styles.modalBody}>
          <Text>
            <strong>{addedEmail}</strong> has been added to your board. You can now assign
            tasks to them.
          </Text>
          <Button variant="jumbo" onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal toggleModal={onClose} title="Add people to the board" size="sm">
      <form className={styles.modalBody} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="assignee-email">Email address</label>
          <input
            id="assignee-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            aria-describedby={error ? 'assignee-email-error' : undefined}
            aria-invalid={error ? 'true' : undefined}
          />
          {error && (
            <p id="assignee-email-error" className={styles.fieldError} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className={styles.modalActions}>
          <Button variant="outline" color="error" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || !email.trim()}>
            {isSubmitting ? 'Adding…' : 'Add to board'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

AddPeopleModal.propTypes = {
  onClose: PropTypes.func.isRequired,
};
