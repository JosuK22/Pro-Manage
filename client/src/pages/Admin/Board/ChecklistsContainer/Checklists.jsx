import { useContext, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';

import { Text } from '../../../../components/ui';
import { TasksContext } from '../../../../store/TaskProvider';
import Checklist from '../CheckList/Checklist';

import styles from './Checklists.module.css';

export default function CheckLists({ task, isOpen, toggleDisclosure }) {
  const lists = task.checklists ?? [];
  const dones = lists.filter((list) => list.checked);
  const { minorTaskUpdate } = useContext(TasksContext);
  const [pendingId, setPendingId] = useState(null);
  const panelId = useId();

  const handleList = async (listId, value) => {
    const index = lists.findIndex((list) => list._id === listId);
    if (index < 0) return;

    // Send the whole checklist array — the API replaces it wholesale.
    const next = lists.map((list, i) =>
      i === index ? { ...list, checked: value } : { ...list }
    );

    setPendingId(listId);
    try {
      await minorTaskUpdate(task, { checklists: next });
    } catch (err) {
      // TaskProvider has already rolled the tick back.
      if (!err.isSessionExpired) {
        toast.error(err.message || 'Could not update this checklist item.');
      }
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.heading}>
        {/* Was "Checklits". */}
        <Text as="span" step={2} weight="500">
          Checklist ({dones.length}/{lists.length})
        </Text>

        <button
          type="button"
          className={styles.button}
          onClick={toggleDisclosure}
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={`${isOpen ? 'Hide' : 'Show'} checklist for ${task.title}`}
        >
          <ChevronDown size={18} className={isOpen ? styles.rotate : undefined} />
        </button>
      </div>

      {isOpen && (
        <ul id={panelId} className={styles.lists}>
          {lists.map((list) => (
            <li key={list._id}>
              <Checklist
                list={list}
                onChange={handleList}
                isPending={pendingId === list._id}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

CheckLists.propTypes = {
  task: PropTypes.object.isRequired,
  isOpen: PropTypes.bool.isRequired,
  toggleDisclosure: PropTypes.func.isRequired,
};
