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
  className = '',
  ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[styles[color], styles[variant], styles.button, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
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
  className: PropTypes.string,
};
