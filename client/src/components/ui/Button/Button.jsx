import PropTypes from 'prop-types';
import styles from './Button.module.css';

export default function Button({
  children,
  color = 'primary',
  variant,
  onClick,
  // Defaults to "button": a bare <button> inside a <form> submits it, which
  // caused stray submits from unrelated controls (e.g. the checklist trash
  // icon). Callers that really are the submit control opt in explicitly.
  type = 'button',
  disabled = false,
  loading = false,
  className = '',
  ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      // A button that is mid-request must not be clickable again — this is what
      // stops a double submit from creating two tasks or two accounts.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[styles[color], styles[variant], styles.button, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {/* The label stays rendered so the button keeps its width and its
          accessible name; the spinner sits alongside it rather than replacing
          it, which is what used to make buttons jump size mid-submit. */}
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

Button.propTypes = {
  children: PropTypes.node,
  color: PropTypes.oneOf(['primary', 'error', 'success', 'neutral']),
  variant: PropTypes.oneOf(['outline', 'jumbo', 'ghost']),
  onClick: PropTypes.func,
  type: PropTypes.oneOf(['button', 'submit', 'reset']),
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  className: PropTypes.string,
};
