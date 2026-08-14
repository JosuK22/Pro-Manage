import PropTypes from 'prop-types';

import styles from './PageHeader.module.css';

/**
 * Consistent page title block.
 *
 * Renders a real <h1> so every screen starts a correct heading outline, and
 * gives all pages the same spacing and title/description/actions rhythm.
 */
export default function PageHeader({ title, description, actions, meta }) {
  return (
    <header className={styles.header}>
      <div className={styles.titleGroup}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {meta}
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>

      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

PageHeader.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  actions: PropTypes.node,
  meta: PropTypes.node,
};
