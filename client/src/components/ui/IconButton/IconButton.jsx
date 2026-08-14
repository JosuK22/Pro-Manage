import PropTypes from 'prop-types';

import styles from './IconButton.module.css';

/**
 * Icon-only control.
 *
 * `label` is required, not optional: an icon-only button has no accessible
 * name otherwise, and the app was full of clickable bare <svg>s and <div>s
 * that keyboard and screen-reader users could not reach or identify at all.
 * The label doubles as the hover tooltip via `title`.
 */
export default function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  size = 'md',
  tone = 'default',
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`${styles.button} ${styles[size]} ${styles[tone]}`}
      {...rest}
    >
      {children}
    </button>
  );
}

IconButton.propTypes = {
  children: PropTypes.node.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func,
  disabled: PropTypes.bool,
  size: PropTypes.oneOf(['sm', 'md']),
  tone: PropTypes.oneOf(['default', 'primary', 'danger']),
  type: PropTypes.oneOf(['button', 'submit']),
};
