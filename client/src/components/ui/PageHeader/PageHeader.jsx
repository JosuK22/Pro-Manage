import PropTypes from 'prop-types';

import styles from './PageHeader.module.css';

/**
 * Consistent page title block.
 *
 * Renders a real <h1> so every screen starts a correct heading outline, and
 * gives all pages the same spacing and title/description/actions rhythm.
 */
export default function PageHeader({ title, description, actions, meta, eyebrow }) {
  return (
    <header className={styles.header}>
      <div className={styles.titleGroup}>
        {/* Technical eyebrow: answers "what screen am I on?" before the eye
            even reaches the title, and carries the retro voice in the one
            place where it costs the reader nothing. */}
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}

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
  eyebrow: PropTypes.string,
};
