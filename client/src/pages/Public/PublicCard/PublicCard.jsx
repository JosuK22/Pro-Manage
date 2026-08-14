import PropTypes from 'prop-types';
import { Eye } from 'lucide-react';

import { Text, Badge, Avatar } from '../../../components/ui';
import { TASK_PRIORITIES } from '../../../constants/task';
import getFormattedDate from '../../../utils/getFormatedDate';

import styles from './PublicCard.module.css';

export default function PublicCard({ task }) {
  // A shared task may legitimately have no checklist items yet; default so the
  // page renders instead of throwing on `.filter` of undefined.
  const checklists = task.checklists ?? [];
  const dones = checklists.filter((list) => list.checked);

  const priority =
    TASK_PRIORITIES.find((item) => item.value === task.priority) ?? TASK_PRIORITIES[2];

  return (
    <article className={styles.container}>
      <div className={styles.header}>
        <Text as="span" step={1} weight="600" className={styles.priority}>
          {/* The dot alone would carry the meaning by colour only, so the
              label spells the priority out in text as well. */}
          <span className={styles.dot} style={{ background: priority.color }} aria-hidden="true" />
          {priority.label}
        </Text>

        <Avatar email={task.assignee} size="lg" />
      </div>

      <h1 className={styles.title}>{task.title}</h1>

      <p className={styles.readOnlyNote}>
        <Eye size={14} aria-hidden="true" />
        You’re viewing a shared task. It can’t be edited here.
      </p>

      <section className={styles.checklists} aria-label="Checklist">
        <Text as="h2" step={3} weight="600">
          Checklist ({dones.length}/{checklists.length})
        </Text>

        {checklists.length === 0 ? (
          <Text step={2} color="var(--text-muted)">
            No checklist items on this task.
          </Text>
        ) : (
          <ul className={styles.lists}>
            {checklists.map((list) => (
              // Mongo subdocuments expose `_id`, not `id`. Keying on the
              // missing `list.id` gave every row `key={undefined}`.
              <li key={list._id} className={styles.list}>
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
        )}
      </section>

      {task.dueDate && (
        <div className={styles.dueDate}>
          <Text as="h2" step={3} weight="600">
            Due date
          </Text>
          <Badge variant={task.isExpired ? 'error' : 'default'}>
            {getFormattedDate(new Date(task.dueDate))}
          </Badge>
        </div>
      )}
    </article>
  );
}

PublicCard.propTypes = {
  task: PropTypes.object.isRequired,
};
