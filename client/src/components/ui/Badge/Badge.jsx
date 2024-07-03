import Text from '../Text/Text'
import styles from './Badge.module.css';
import PropTypes from 'prop-types';

export default function Badge({ children, variant = 'default', onClick }) {
  const badgeVariant = styles[variant];

  return (
    <div className={`${badgeVariant} ${styles.badge}`} onClick={onClick}>
      <Text step={1}>{children}</Text>
    </div>
  );
}

Badge.propTypes = {
  children: PropTypes.node,
  variant: PropTypes.string,
  onClick: PropTypes.func,
};
