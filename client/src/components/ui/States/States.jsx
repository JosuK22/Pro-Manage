import PropTypes from 'prop-types';
import { AlertCircle, Inbox, WifiOff } from 'lucide-react';

import Button from '../Button/Button';

import styles from './States.module.css';

/**
 * Content-shaped loading placeholder.
 *
 * Skeletons are used instead of spinners wherever the final layout is known,
 * so the page does not jump when data lands.
 */
export function Skeleton({ width = '100%', height = '1rem', radius = 'var(--radius-sm)' }) {
  return (
    <span
      className={styles.skeleton}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

Skeleton.propTypes = {
  width: PropTypes.string,
  height: PropTypes.string,
  radius: PropTypes.string,
};

export function TaskCardSkeleton() {
  return (
    <div className={styles.cardSkeleton} aria-hidden="true">
      <div className={styles.row}>
        <Skeleton width="7rem" height="0.75rem" />
        <Skeleton width="1.75rem" height="1.75rem" radius="var(--radius-full)" />
      </div>
      <Skeleton width="80%" height="1.15rem" />
      <Skeleton width="45%" height="0.9rem" />
      <div className={styles.row}>
        <Skeleton width="3.5rem" height="1.5rem" radius="var(--radius-md)" />
        <Skeleton width="8rem" height="1.5rem" radius="var(--radius-md)" />
      </div>
    </div>
  );
}

export function ColumnSkeleton({ cards = 2 }) {
  return (
    <div className={styles.columnSkeleton}>
      <Skeleton width="6rem" height="1rem" />
      {Array.from({ length: cards }, (_, index) => (
        <TaskCardSkeleton key={index} />
      ))}
    </div>
  );
}

ColumnSkeleton.propTypes = { cards: PropTypes.number };

export function AnalyticsSkeleton() {
  return (
    <div className={styles.analyticsSkeleton} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className={styles.statSkeleton}>
          <Skeleton width="60%" height="0.8rem" />
          <Skeleton width="2.5rem" height="1.6rem" />
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state.
 *
 * Always answers the three questions a blank screen raises: what happened,
 * why it is empty, and what to do next.
 */
export function EmptyState({ title, description, action, icon: Icon = Inbox, compact = false }) {
  return (
    <div className={`${styles.state} ${compact ? styles.compact : ''}`}>
      <span className={styles.stateIcon} aria-hidden="true">
        <Icon />
      </span>
      <p className={styles.stateTitle}>{title}</p>
      {description && <p className={styles.stateBody}>{description}</p>}
      {action}
    </div>
  );
}

EmptyState.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  action: PropTypes.node,
  icon: PropTypes.elementType,
  compact: PropTypes.bool,
};

/**
 * Error state with a retry affordance.
 *
 * `role="alert"` so a screen reader announces the failure rather than leaving
 * the user waiting on a region that silently stopped loading.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We couldn’t load this right now.',
  onRetry,
  isRetrying = false,
  compact = false,
}) {
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <div
      className={`${styles.state} ${styles.error} ${compact ? styles.compact : ''}`}
      role="alert"
    >
      <span className={styles.stateIcon} aria-hidden="true">
        {isOffline ? <WifiOff /> : <AlertCircle />}
      </span>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateBody}>
        {isOffline ? 'You appear to be offline. Check your connection.' : description}
      </p>
      {onRetry && (
        <Button onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? 'Retrying…' : 'Try again'}
        </Button>
      )}
    </div>
  );
}

ErrorState.propTypes = {
  title: PropTypes.string,
  description: PropTypes.string,
  onRetry: PropTypes.func,
  isRetrying: PropTypes.bool,
  compact: PropTypes.bool,
};
