import PropTypes from 'prop-types';

import styles from './Badge.module.css';

/**
 * Small status pill.
 *
 * When `onClick` is supplied it renders a real <button> rather than a
 * clickable <div>, so the board's "move to column" badges are reachable by
 * keyboard and announced as actions. `label` provides the accessible name when
 * the visible text alone is ambiguous ("Done" -> "Move task to Done").
 */
export default function Badge({
  children,
  variant = 'default',
  onClick,
  label,
  disabled = false,
}) {
  const className = `${styles.badge} ${styles[variant] || styles.default}`;

  if (!onClick) {
    return <span className={className}>{children}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${className} ${styles.interactive}`}
    >
      {children}
    </button>
  );
}

Badge.propTypes = {
  children: PropTypes.node,
  variant: PropTypes.oneOf(['default', 'success', 'error', 'warning', 'primary']),
  onClick: PropTypes.func,
  label: PropTypes.string,
  disabled: PropTypes.bool,
};
