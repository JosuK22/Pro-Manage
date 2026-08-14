import PropTypes from 'prop-types';
import { UserRound } from 'lucide-react';

import styles from './Avatar.module.css';

/**
 * Assignee avatar.
 *
 * A task's `assignee` is optional, so this component treats "no assignee" as a
 * first-class state rather than something callers must guard against. Passing
 * null/undefined/'' renders a labelled "Unassigned" placeholder instead of
 * crashing on `.substring()`.
 */
export default function Avatar({ email, size = 'sm' }) {
  const value = typeof email === 'string' ? email.trim() : '';

  if (!value) {
    return (
      <span
        className={`${styles.avatar} ${styles[size]} ${styles.unassigned}`}
        title="Unassigned"
        aria-label="Unassigned"
        role="img"
      >
        <UserRound className={styles.icon} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={`${styles.avatar} ${styles[size]}`}
      title={value}
      aria-label={`Assigned to ${value}`}
      role="img"
    >
      {value.substring(0, 2).toUpperCase()}
    </span>
  );
}

Avatar.propTypes = {
  email: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
};
