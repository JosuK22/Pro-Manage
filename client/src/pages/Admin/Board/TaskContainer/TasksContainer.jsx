import { useCallback, useContext, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

import { TasksContext } from '../../../../store/TaskProvider';
import { TASK_STATUSES, STATUS_TITLES } from '../../../../constants/task';
import Container from '../CardsContainer/Container';
import { Button, ColumnSkeleton, EmptyState, ErrorState } from '../../../../components/ui';

import styles from './TaskContainer.module.css';

export default function TasksContainer({
  tasks,
  hasActiveFilters,
  onClearFilters,
  onCreateTask,
}) {
  const { isLoading, error, fetchTasks, minorTaskUpdate } = useContext(TasksContext);
  const [activeStatus, setActiveStatus] = useState(TASK_STATUSES[1].value);
  const [draggedTask, setDraggedTask] = useState(null);

  /**
   * Mouse needs a small distance threshold and touch a short delay, otherwise
   * the sensors swallow ordinary clicks and vertical scrolling inside a column.
   * The keyboard sensor is what makes dragging usable without a pointer.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = useCallback(
    ({ active, over }) => {
      setDraggedTask(null);

      const task = active?.data?.current?.task;
      // Dropped outside a column, or back where it started.
      if (!task || !over || task.status === over.id) return;

      // Optimistic in the provider, which rolls the board back if this rejects;
      // the card must never sit in a column the server refused.
      minorTaskUpdate(task, { status: over.id }).catch((err) => {
        if (!err.isSessionExpired) toast.error(err.message || 'Could not move this task.');
      });
    },
    [minorTaskUpdate]
  );

  /** Spoken feedback for keyboard/screen-reader dragging. */
  const announcements = useMemo(
    () => ({
      onDragStart: ({ active }) =>
        `Picked up ${active.data.current?.task?.title ?? 'task'}.`,
      onDragOver: ({ over }) =>
        over ? `Over ${STATUS_TITLES[over.id]}.` : 'Not over a column.',
      onDragEnd: ({ active, over }) =>
        over
          ? `Moved ${active.data.current?.task?.title ?? 'task'} to ${STATUS_TITLES[over.id]}.`
          : 'Move cancelled.',
      onDragCancel: () => 'Move cancelled.',
    }),
    []
  );

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
        title="We couldn’t load your tasks"
        description="Something went wrong on the way to the server. Your work is safe."
        onRetry={fetchTasks}
      />
    );
  }

  // Nothing at all: a brand-new account, or every task filtered away. These
  // are different situations and deserve different guidance.
  if (tasks && tasks.length === 0) {
    return hasActiveFilters ? (
      <EmptyState
        title="No matches"
        description="Nothing matches your current search and filters."
        action={
          <Button variant="outline" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="Your workspace is clear"
        description="No tasks yet. Create your first one to start organising your work."
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

      {/* Drag-and-drop layers on top of the existing board; the per-card status
          badges are untouched and remain the accessible fallback. */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements }}
        onDragStart={({ active }) => setDraggedTask(active.data.current?.task ?? null)}
        onDragCancel={() => setDraggedTask(null)}
        onDragEnd={handleDragEnd}
      >
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

        {/* A lightweight preview follows the cursor, so the real card can stay
            in place as a dimmed placeholder instead of jumping out of the list. */}
        <DragOverlay dropAnimation={null}>
          {draggedTask && (
            <div className={styles.dragPreview}>{draggedTask.title}</div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}

TasksContainer.propTypes = {
  tasks: PropTypes.array,
  hasActiveFilters: PropTypes.bool,
  onClearFilters: PropTypes.func.isRequired,
  onCreateTask: PropTypes.func.isRequired,
};
