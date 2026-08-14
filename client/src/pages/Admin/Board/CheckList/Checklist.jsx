import { useId } from 'react';
import PropTypes from 'prop-types';

import styles from './Checklilst.module.css';

export default function Checklist({ list, onChange, isPending = false }) {
  const inputId = useId();

  return (
    <div className={styles.container}>
      <input
        id={inputId}
        type="checkbox"
        checked={list.checked}
        disabled={isPending}
        onChange={(event) => onChange(list._id, event.target.checked)}
      />

      {/* A real <label>: the whole row becomes a hit target and screen readers
          announce the item text as the checkbox's name. */}
      <label htmlFor={inputId} className={styles.label}>
        {list.title}
      </label>
    </div>
  );
}

Checklist.propTypes = {
  list: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  isPending: PropTypes.bool,
};
