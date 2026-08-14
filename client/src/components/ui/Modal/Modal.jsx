import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { X } from 'lucide-react';

import styles from './Modal.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog.
 *
 * The previous implementation was a plain pair of divs: no role, no accessible
 * name, no Escape handling, no focus management, and a fixed pixel width that
 * overflowed small screens. Keyboard users could tab straight out of the modal
 * into the page behind it and never find their way back.
 */
export default function Modal({ children, toggleModal, title, size = 'md' }) {
  const dialogRef = useRef(null);
  // Where focus was before the dialog opened, so it can be handed back on close.
  const previouslyFocused = useRef(null);
  const titleId = useId();

  useEffect(() => {
    previouslyFocused.current = document.activeElement;

    // Move focus into the dialog: the first control if there is one, otherwise
    // the dialog itself, so the next Tab starts inside.
    const node = dialogRef.current;
    const firstFocusable = node?.querySelector(FOCUSABLE);
    (firstFocusable || node)?.focus();

    // The page behind must not scroll while a dialog is open.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;
      // Restore focus so keyboard and screen-reader users resume where they were.
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      toggleModal();
      return;
    }

    if (event.key !== 'Tab') return;

    // Focus trap: wrap from last to first and back again.
    const focusable = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Rendered in a portal so the dialog is never clipped by an ancestor's
  // overflow/transform (the board columns scroll, and used to cut modals off).
  return createPortal(
    <div className={styles.container} onKeyDown={handleKeyDown}>
      <div className={styles.backdrop} onClick={toggleModal} aria-hidden="true" />

      <div
        ref={dialogRef}
        className={`${styles.content} ${styles[size]}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : 'Dialog'}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        {title && (
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <button
              type="button"
              className={styles.close}
              onClick={toggleModal}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
          </div>
        )}

        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

Modal.propTypes = {
  children: PropTypes.node,
  toggleModal: PropTypes.func.isRequired,
  title: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
};
