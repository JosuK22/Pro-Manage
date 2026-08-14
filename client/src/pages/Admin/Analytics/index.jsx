import { useCallback } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, ListTodo, AlertTriangle, ArrowRight } from 'lucide-react';

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
  { name: 'High priority', key: 'high' },
  { name: 'Moderate priority', key: 'moderate' },
  { name: 'Low priority', key: 'low' },
];

/**
 * Headline tiles — the four numbers worth seeing before anything else.
 *
 * `to` makes a tile a way *into* the work rather than a dead end: Overdue
 * links to the board already filtered to overdue tasks. Tiles without a
 * meaningful destination stay plain text rather than pretending to be links.
 */
const summaryTiles = (data) => [
  { label: 'Total tasks', value: data.total, icon: ListTodo, tone: 'primary' },
  { label: 'Completed', value: data.status.done, icon: CheckCircle2, tone: 'success' },
  { label: 'In progress', value: data.status.inProgress, icon: Clock, tone: 'default' },
  {
    label: 'Overdue',
    value: data.priorities.due,
    icon: AlertTriangle,
    tone: 'error',
    to: '/?attention=overdue',
  },
];

function Tile({ tile }) {
  const body = (
    <>
      <span className={styles.tileIcon} aria-hidden="true">
        <tile.icon size={17} />
      </span>
      <span className={styles.tileValue}>{tile.value}</span>
      <span className={styles.tileLabel}>
        {tile.label}
        {tile.to && <ArrowRight size={13} aria-hidden="true" className={styles.tileArrow} />}
      </span>
    </>
  );

  const className = `${styles.tile} ${styles[tile.tone]}`;

  // Only offer the affordance when there is somewhere to go, and only when the
  // count is non-zero — a link to "0 overdue tasks" wastes the click.
  if (tile.to && tile.value > 0) {
    return (
      <Link to={tile.to} className={`${className} ${styles.tileLink}`}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}

Tile.propTypes = { tile: PropTypes.object.isRequired };

function StatList({ title, rows, counts, total }) {
  const headingId = `${title.replace(/\s+/g, '-').toLowerCase()}-heading`;

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.panelTitle}>
        {title}
      </h2>

      <ul className={styles.rows}>
        {rows.map((row) => {
          const count = counts[row.key] ?? 0;
          // A proportion bar makes the distribution readable at a glance
          // without pulling in a charting library for a handful of numbers.
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <li key={row.key} className={styles.row}>
              <span className={styles.rowLabel}>{row.name}</span>

              <span
                className={styles.meter}
                role="img"
                aria-label={`${count} of ${total} tasks (${percent}%)`}
              >
                <span
                  className={`${styles.meterFill} ${styles[row.key] ?? ''}`}
                  style={{ width: `${percent}%` }}
                />
              </span>

              <span className={styles.rowValue}>{count}</span>
              <span className={styles.rowPercent} aria-hidden="true">
                {percent}%
              </span>
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

  /** Completion rate is the one derived figure that answers "am I getting through it?". */
  const completion =
    analytics && analytics.total > 0
      ? Math.round((analytics.status.done / analytics.total) * 100)
      : 0;

  return (
    <div className={styles.container}>
      <PageHeader
        eyebrow="Report"
        title="Analytics"
        description="How your work is distributed across the board."
      />

      {isLoading && <AnalyticsSkeleton />}

      {/* Errors were previously invisible here — the page just rendered
          nothing and looked like a user with no data. */}
      {!isLoading && error && (
        <ErrorState
          title="We couldn’t load your analytics"
          description="Something went wrong on the way to the server. Your work is safe."
          onRetry={retry}
        />
      )}

      {!isLoading && !error && analytics && analytics.total === 0 && (
        <EmptyState
          title="Nothing to report yet"
          description="Create your first task and your statistics will appear here."
        />
      )}

      {!isLoading && !error && analytics && analytics.total > 0 && (
        <>
          <div className={styles.tiles}>
            {summaryTiles(analytics).map((tile) => (
              <Tile key={tile.label} tile={tile} />
            ))}
          </div>

          {/* --- Completion summary ------------------------------------- */}
          <section className={styles.completion} aria-labelledby="completion-heading">
            <div className={styles.completionHead}>
              <h2 id="completion-heading" className={styles.panelTitle}>
                Completion
              </h2>
              <span className={styles.completionValue}>{completion}%</span>
            </div>

            <span
              className={styles.completionMeter}
              role="img"
              aria-label={`${analytics.status.done} of ${analytics.total} tasks complete`}
            >
              <span
                className={styles.completionFill}
                style={{ width: `${completion}%` }}
              />
            </span>

            <p className={styles.completionNote}>
              {analytics.status.done} of {analytics.total} tasks done
              {analytics.priorities.due > 0 && (
                <>
                  {' · '}
                  <Link to="/?attention=overdue" className={styles.inlineLink}>
                    {analytics.priorities.due} overdue
                  </Link>
                </>
              )}
            </p>
          </section>

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
