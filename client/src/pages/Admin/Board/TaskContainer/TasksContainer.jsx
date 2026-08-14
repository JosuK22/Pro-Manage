import { useContext, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import { TasksContext } from '../../../../store/TaskProvider';
import { TASK_STATUSES } from '../../../../constants/task';
import Container from '../CardsContainer/Container';
import { Button, ColumnSkeleton, EmptyState, ErrorState } from '../../../../components/ui';

import styles from './TaskContainer.module.css';

export default function TasksContainer({
  tasks,
  hasActiveFilters,
  onClearFilters,
  onCreateTask,
}) {
  const { isLoading, error, fetchTasks } = useContext(TasksContext);
  const [activeStatus, setActiveStatus] = useState(TASK_STATUSES[1].value);

  /**
   * Group once, not once per column.
   *
   * Each of the four columns used to filter the whole task array itself, so
   * rendering the board was four full scans; this is one.
   */
  const grouped = useMemo(() => {
    const buckets = TASK_STATUSES.reduce((acc, status) => {
      acc[status.value] = [];
      return acc;
    }, {});

    (tasks ?? []).forEach((task) => {
      if (buckets[task.status]) buckets[task.status].push(task);
    });

    return buckets;
  }, [tasks]);

  if (isLoading) {
    return (
      <div className={styles.columns}>
        {TASK_STATUSES.map((status) => (
          <ColumnSkeleton key={status.value} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn’t load your tasks"
        description="Something went wrong while fetching the board."
        onRetry={fetchTasks}
      />
    );
  }

  // Nothing at all: a brand-new account, or every task filtered away. These
  // are different situations and deserve different guidance.
  if (tasks && tasks.length === 0) {
    return hasActiveFilters ? (
      <EmptyState
        title="No matching tasks"
        description="Try a different search term or clear your filters."
        action={
          <Button variant="outline" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="No tasks yet"
        description="Create your first task and start organising your work."
        action={<Button onClick={onCreateTask}>Create task</Button>}
      />
    );
  }

  return (
    <>
      {/* Mobile: horizontally scrollable status tabs, then one column below.
          Forcing a 4-column, ~1900px board through a 375px screen is what made
          the old layout unusable on a phone. */}
      <div className={styles.tabs} role="tablist" aria-label="Task status">
        {TASK_STATUSES.map((status) => (
          <button
            key={status.value}
            type="button"
            role="tab"
            id={`tab-${status.value}`}
            aria-selected={activeStatus === status.value}
            aria-controls={`panel-${status.value}`}
            onClick={() => setActiveStatus(status.value)}
            className={`${styles.tab} ${
              activeStatus === status.value ? styles.tabActive : ''
            }`}
          >
            {status.title}
            <span className={styles.tabCount}>{grouped[status.value].length}</span>
          </button>
        ))}
      </div>

      <div className={styles.columns}>
        {TASK_STATUSES.map((status) => (
          <div
            key={status.value}
            id={`panel-${status.value}`}
            role="tabpanel"
            aria-labelledby={`tab-${status.value}`}
            // Only the selected column is shown on mobile; CSS reveals all four
            // from 640px up, where `hidden` is overridden.
            className={`${styles.column} ${
              activeStatus === status.value ? styles.columnActive : ''
            }`}
          >
            <Container
              tasks={grouped[status.value]}
              category={status}
              onCreateTask={onCreateTask}
            />
          </div>
        ))}
      </div>
    </>
  );
}

TasksContainer.propTypes = {
  tasks: PropTypes.array,
  hasActiveFilters: PropTypes.bool,
  onClearFilters: PropTypes.func.isRequired,
  onCreateTask: PropTypes.func.isRequired,
};
