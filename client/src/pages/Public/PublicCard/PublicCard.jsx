import PropTypes from 'prop-types';
import { Eye } from 'lucide-react';

import { Avatar } from '../../../components/ui';
import { TASK_PRIORITIES } from '../../../constants/task';
import { getUrgency, taskRef, URGENCY } from '../../../utils/taskUrgency';
import getFormattedDate from '../../../utils/getFormatedDate';

import styles from './PublicCard.module.css';

/**
 * The read-only shared view of a task.
 *
 * Deliberately reads as a *document* rather than a dashboard card: a header
 * plate with the reference, then labelled fields, then the checklist. Someone
 * arriving from a link has no app context, so every value is captioned.
 */
export default function PublicCard({ task }) {
  // A shared task may legitimately have no checklist items yet; default so the
  // page renders instead of throwing on `.filter` of undefined.
  const checklists = task.checklists ?? [];
  const dones = checklists.filter((list) => list.checked);
  const percent = checklists.length
    ? Math.round((dones.length / checklists.length) * 100)
    : 0;

  const priority =
    TASK_PRIORITIES.find((item) => item.value === task.priority) ?? TASK_PRIORITIES[2];

  const urgency = getUrgency(task);

  return (
    <article className={styles.container}>
      {/* --- Document header ------------------------------------------- */}
      <div className={styles.plate}>
        <span className={styles.ref}>{taskRef(task._id)}</span>
        <span className={styles.readOnly}>
          <Eye size={13} aria-hidden="true" />
          Read only
        </span>
      </div>

      <h1 className={styles.title}>{task.title}</h1>

      {/* --- Field list -------------------------------------------------
          Captioned rows rather than bare chips: a stranger needs to be told
          which value is the priority and which is the deadline. */}
      <dl className={styles.fields}>
        <div className={styles.field}>
          <dt className={styles.fieldLabel}>Priority</dt>
          <dd className={`${styles.fieldValue} ${styles[priority.value]}`}>
            <span
              className={styles.dot}
              style={{ background: priority.color }}
              aria-hidden="true"
            />
            {priority.shortLabel}
          </dd>
        </div>

        <div className={styles.field}>
          <dt className={styles.fieldLabel}>Assigned to</dt>
          <dd className={styles.fieldValue}>
            <Avatar email={task.assignee} size="sm" />
            <span className={styles.assigneeName}>{task.assignee || 'Unassigned'}</span>
          </dd>
        </div>

        {task.dueDate && (
          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Due</dt>
            <dd
              className={`${styles.fieldValue} ${
                urgency.level === URGENCY.OVERDUE ? styles.overdue : ''
              }`}
            >
              {getFormattedDate(new Date(task.dueDate))}
              {urgency.level === URGENCY.OVERDUE && (
                <span className={styles.overdueTag}>Overdue</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {/* --- Checklist --------------------------------------------------- */}
      <section className={styles.checklists} aria-labelledby="checklist-heading">
        <div className={styles.checklistHead}>
          <h2 id="checklist-heading" className={styles.sectionTitle}>
            Checklist
          </h2>
          <span className={styles.progressCount}>
            {dones.length}/{checklists.length}
          </span>
        </div>

        {checklists.length === 0 ? (
          <p className={styles.emptyNote}>No checklist items on this task.</p>
        ) : (
          <>
            <span
              className={styles.meter}
              role="img"
              aria-label={`${dones.length} of ${checklists.length} items complete`}
            >
              <span className={styles.meterFill} style={{ width: `${percent}%` }} />
            </span>

            <ul className={styles.lists}>
              {checklists.map((list) => (
                // Mongo subdocuments expose `_id`, not `id`. Keying on the
                // missing `list.id` gave every row `key={undefined}`.
                <li
                  key={list._id}
                  className={`${styles.list} ${list.checked ? styles.listDone : ''}`}
                >
                  <input
                    type="checkbox"
                    id={`checkbox-${list._id}`}
                    checked={list.checked}
                    // Read-only public view. `disabled` both silences React's
                    // controlled-input warning and tells assistive tech that the
                    // state cannot be changed here.
                    disabled
                    readOnly
                  />
                  <label htmlFor={`checkbox-${list._id}`}>{list.title}</label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </article>
  );
}

PublicCard.propTypes = {
  task: PropTypes.object.isRequired,
};
