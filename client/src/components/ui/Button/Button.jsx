import PropTypes from 'prop-types';
import styles from './Button.module.css';

export default function Button({
  children,
  color = 'primary',
  variant,
  onClick,
}) {
  return (
    <button
      onClick={onClick}
      className={`${styles[color]} ${styles[variant]} ${styles.button}`}
    >
      {children}
    </button>
  );
}

Button.propTypes = {
  children: PropTypes.string,
  toggle: PropTypes.func,
  color: PropTypes.oneOf(['primary', 'error', 'success', 'neutral']),
  variant: PropTypes.oneOf(['outline','jumbo', 'ghost']),
  onClick: PropTypes.func,
};
