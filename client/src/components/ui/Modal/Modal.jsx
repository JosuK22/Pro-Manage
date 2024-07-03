import styles from './Modal.module.css';
import PropTypes from 'prop-types';

export default function Modal({ children, toggleModal }) {
  return (
    <div className={styles.container}>
      <div onClick={toggleModal} className={styles.backdrop} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}

Modal.propTypes = {
  children: PropTypes.node,
  toggleModal: PropTypes.func,
};
