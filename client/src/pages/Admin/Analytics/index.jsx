import { useCallback } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle2, Clock, ListTodo, AlertTriangle } from 'lucide-react';

import { PageHeader, AnalyticsSkeleton, ErrorState, EmptyState } from '../../../components/ui';
import useApiResource from '../../../hooks/useApiResource';
import { taskApi } from '../../../services';

import styles from './index.module.css';

const STATUS_ROWS = [
  { name: 'Backlog', key: 'backlog' },
  { name: 'To do', key: 'todo' },
  { name: 'In progress', key: 'inProgress' },
  { name: 'Completed', key: 'done' },
];

const PRIORITY_ROWS = [
  { name: 'Low priority', key: 'low' },
  { name: 'Moderate priority', key: 'moderate' },
  { name: 'High priority', key: 'high' },
  { name: 'Overdue', key: 'due' },
];

/** Headline tiles — the four numbers worth seeing before anything else. */
const summaryTiles = (data) => [
  { label: 'Total tasks', value: data.total, icon: ListTodo, tone: 'primary' },
  { label: 'Completed', value: data.status.done, icon: CheckCircle2, tone: 'success' },
  { label: 'In progress', value: data.status.inProgress, icon: Clock, tone: 'default' },
  { label: 'Overdue', value: data.priorities.due, icon: AlertTriangle, tone: 'error' },
];

function StatList({ title, rows, counts, total }) {
  return (
    <section className={styles.panel} aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`} className={styles.panelTitle}>
        {title}
      </h2>

      <ul className={styles.rows}>
        {rows.map((row) => {
          const count = counts[row.key] ?? 0;
          // A proportion bar makes the distribution readable at a glance
          // without pulling in a charting library for four numbers.
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <li key={row.key} className={styles.row}>
              <span className={styles.rowLabel}>{row.name}</span>

              <span
                className={styles.meter}
                role="img"
                aria-label={`${count} of ${total} tasks (${percent}%)`}
              >
                <span className={styles.meterFill} style={{ width: `${percent}%` }} />
              </span>

              <span className={styles.rowValue}>{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

StatList.propTypes = {
  title: PropTypes.string.isRequired,
  rows: PropTypes.array.isRequired,
  counts: PropTypes.object.isRequired,
  total: PropTypes.number.isRequired,
};

export default function Analytics() {
  const fetchAnalytics = useCallback(({ signal }) => taskApi.analytics({ signal }), []);
  const { data, isLoading, error, retry } = useApiResource(fetchAnalytics);

  const analytics = data?.data;

  return (
    <div className={styles.container}>
      <PageHeader
        title="Analytics"
        description="How your work is distributed across the board."
      />

      {isLoading && <AnalyticsSkeleton />}

      {/* Errors were previously invisible here — the page just rendered
          nothing and looked like a user with no data. */}
      {!isLoading && error && (
        <ErrorState
          title="Couldn’t load analytics"
          description="We couldn’t fetch your task statistics."
          onRetry={retry}
        />
      )}

      {!isLoading && !error && analytics && analytics.total === 0 && (
        <EmptyState
          title="No data yet"
          description="Create your first task and your statistics will appear here."
        />
      )}

      {!isLoading && !error && analytics && analytics.total > 0 && (
        <>
          <div className={styles.tiles}>
            {summaryTiles(analytics).map((tile) => (
              <div key={tile.label} className={`${styles.tile} ${styles[tile.tone]}`}>
                <span className={styles.tileIcon} aria-hidden="true">
                  <tile.icon size={18} />
                </span>
                <span className={styles.tileValue}>{tile.value}</span>
                <span className={styles.tileLabel}>{tile.label}</span>
              </div>
            ))}
          </div>

          <div className={styles.panels}>
            <StatList
              title="Tasks by status"
              rows={STATUS_ROWS}
              counts={analytics.status}
              total={analytics.total}
            />
            <StatList
              title="Tasks by priority"
              rows={PRIORITY_ROWS}
              counts={analytics.priorities}
              total={analytics.total}
            />
          </div>
        </>
      )}
    </div>
  );
}
