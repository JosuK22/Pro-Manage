import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { CopyMinus, Plus } from 'lucide-react';
import PropTypes from 'prop-types';

import { IconButton, EmptyState } from '../../../../components/ui';
import Card from '../Card/Card';

import styles from './Container.module.css';

export default function Container({ tasks, category, onCreateTask }) {
  const [openDisclosures, setOpenDisclosures] = useState([]);

  const toggleDisclosure = (id) => {
    setOpenDisclosures((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const collapseAll = () => setOpenDisclosures([]);

  // The whole column is the drop target — including its header — so a card
  // dropped anywhere over the column lands in it.
  const { setNodeRef, isOver } = useDroppable({ id: category.value });

  return (
    <section
      ref={setNodeRef}
      className={`${styles.container} ${isOver ? styles.isOver : ''}`}
      aria-label={`${category.title} tasks`}
    >
      <div className={styles.heading}>
        <div className={styles.headingText}>
          {/* Column names are technical labels, so they take the mono voice —
              one of the few places the retro register costs nothing. */}
          <h3 className={styles.columnTitle}>{category.title}</h3>
          <span className={styles.count}>{tasks.length}</span>
        </div>

        <div className={styles.icons}>
          {category.value === 'todo' && (
            // Was a bare clickable <svg> with no accessible name.
            <IconButton label="Add a task to To do" size="sm" onClick={onCreateTask}>
              <Plus size={18} />
            </IconButton>
          )}

          <IconButton
            label={`Collapse all checklists in ${category.title}`}
            size="sm"
            onClick={collapseAll}
            disabled={openDisclosures.length === 0}
            tone={openDisclosures.length ? 'primary' : 'default'}
          >
            <CopyMinus size={18} style={{ transform: 'scaleX(-1)' }} />
          </IconButton>
        </div>
      </div>

      <div className={styles.scroll}>
        {tasks.length === 0 ? (
          <EmptyState
            compact
            title="Nothing here"
            description={
              category.value === 'todo'
                ? 'Add a task to get started.'
                : `No tasks in ${category.title.toLowerCase()}.`
            }
          />
        ) : (
          <ul className={styles.tasks}>
            {tasks.map((task) => (
              <li key={task._id}>
                <Card
                  task={task}
                  isOpen={openDisclosures.includes(task._id)}
                  toggleDisclosure={() => toggleDisclosure(task._id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

Container.propTypes = {
  tasks: PropTypes.array.isRequired,
  category: PropTypes.object.isRequired,
  onCreateTask: PropTypes.func.isRequired,
};
