import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useSearchParams } from 'react-router-dom';
import { Listbox } from '@headlessui/react';
import { AlertTriangle, ChevronDown, Clock, Plus, Search, UserPlus, UserX, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { Text, Modal, Button, PageHeader, IconButton } from '../../../components/ui';
import { AuthContext } from '../../../store/AuthProvider';
import { TasksContext } from '../../../store/TaskProvider';
import { assigneeApi } from '../../../services';
import { DATE_RANGES, TASK_PRIORITIES } from '../../../constants/task';
import { getAttention, matchesAttention } from '../../../utils/taskUrgency';
import TasksContainer from './TaskContainer/TasksContainer';
import TaskForm from './TaskForm/TaskForm';
import useModal from '../../../hooks/useModal';

import styles from './index.module.css';

/**
 * The "attention required" strip.
 *
 * The board's job is to answer "what should I work on?" before the user has to
 * read any individual card. These three counts are the answer, and each one is
 * a filter — a number you cannot act on is just decoration.
 */
const ATTENTION_ITEMS = [
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'danger' },
  { key: 'today', label: 'Due today', icon: Clock, tone: 'warn' },
  { key: 'unassigned', label: 'Unassigned', icon: UserX, tone: 'muted' },
];

export default function Board() {
  const { user } = useContext(AuthContext);
  const { tasks, selectedDateRange, setSelectedDateRange } = useContext(TasksContext);

  const { isOpen: isAddPeopleOpen, toggleModal: toggleAddPeople } = useModal();

  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const searchRef = useRef(null);

  /**
   * The attention filter lives in the URL so Analytics can link straight into
   * it — "3 overdue" there becomes a filtered board here. It also makes a
   * filtered view shareable and undoable with the back button.
   */
  const attentionFilter = searchParams.get('attention');

  const setAttentionFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('attention', value);
    else next.delete('attention');
    setSearchParams(next, { replace: true });
  };

  /**
   * Create-task lives in the URL rather than in component state, so the mobile
   * top bar can open it from any screen and the back button closes it.
   */
  const isCreateOpen = searchParams.get('new') === 'task';

  const openCreate = () => {
    const next = new URLSearchParams(searchParams);
    next.set('new', 'task');
    setSearchParams(next);
  };

  const closeCreate = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  };

  /** `/` jumps to search, the way it does in every tool that takes search seriously. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      // Don't steal the keystroke from someone typing.
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
        return;
      }

      event.preventDefault();
      searchRef.current?.focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const attention = useMemo(() => getAttention(tasks), [tasks]);

  /**
   * One pass for search, priority and attention. Each column then receives its
   * slice already filtered rather than re-scanning the whole list.
   */
  const filteredTasks = useMemo(() => {
    if (!tasks) return null;

    const term = search.trim().toLowerCase();

    return tasks.filter((task) => {
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      if (!matchesAttention(task, attentionFilter)) return false;
      if (!term) return true;

      return (
        task.title?.toLowerCase().includes(term) ||
        task.assignee?.toLowerCase().includes(term) ||
        task.priority?.toLowerCase().includes(term)
      );
    });
  }, [tasks, search, priorityFilter, attentionFilter]);

  const hasActiveFilters =
    Boolean(search.trim()) || priorityFilter !== 'all' || attentionFilter !== null;

  const clearFilters = () => {
    setSearch('');
    setPriorityFilter('all');

    const next = new URLSearchParams(searchParams);
    next.delete('attention');
    setSearchParams(next, { replace: true });
  };

  const activeCount = tasks ? tasks.filter((task) => task.status !== 'done').length : null;

  return (
    <div className={styles.container}>
      <PageHeader
        eyebrow="Work queue"
        title="Board"
        description={`Signed in as ${user?.info?.name ?? 'there'}`}
        meta={
          activeCount !== null && (
            <span className={styles.countChip}>
              <span className={styles.countValue}>{activeCount}</span> active
            </span>
          )
        }
        actions={
          <>
            <Button variant="outline" onClick={toggleAddPeople}>
              <UserPlus size={16} aria-hidden="true" />
              Add people
            </Button>

            <Button onClick={openCreate}>
              <Plus size={16} aria-hidden="true" />
              New task
            </Button>
          </>
        }
      />

      {/* --- Attention strip -------------------------------------------- */}
      {tasks && (attention.overdue > 0 || attention.today > 0 || attention.unassigned > 0) && (
        <section className={styles.attention} aria-label="Attention required">
          <p className={styles.attentionLabel}>Attention required</p>

          <div className={styles.attentionItems}>
            {ATTENTION_ITEMS.map((item) => {
              const count = attention[item.key];
              if (!count) return null;

              const isActive = attentionFilter === item.key;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setAttentionFilter(isActive ? null : item.key)}
                  aria-pressed={isActive}
                  className={`${styles.attentionChip} ${styles[item.tone]} ${
                    isActive ? styles.chipActive : ''
                  }`}
                >
                  <item.icon size={14} aria-hidden="true" />
                  <span className={styles.chipCount}>{count}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* --- Search and filters ----------------------------------------- */}
      <div className={styles.filters}>
        <div className={styles.searchField}>
          <Search size={16} aria-hidden="true" className={styles.searchIcon} />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks, assignees…"
            aria-label="Search tasks"
          />
          {search ? (
            <IconButton label="Clear search" size="sm" onClick={() => setSearch('')}>
              <X size={16} />
            </IconButton>
          ) : (
            <kbd className={styles.kbd} aria-hidden="true">
              /
            </kbd>
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

          {hasActiveFilters && (
            <Button variant="ghost" onClick={clearFilters} className={styles.clearButton}>
              <X size={14} aria-hidden="true" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <TasksContainer
        tasks={filteredTasks}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onCreateTask={openCreate}
      />

      {isAddPeopleOpen && <AddPeopleModal onClose={toggleAddPeople} />}

      {isCreateOpen && (
        <Modal toggleModal={closeCreate} title="New task" size="lg">
          <TaskForm toggleModal={closeCreate} />
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
          <Button type="submit" loading={isSubmitting} disabled={!email.trim()}>
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
