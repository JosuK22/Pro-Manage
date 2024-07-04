import PropTypes from 'prop-types';
import { Text, Badge } from '../../../components/ui';
import styles from './PublicCard.module.css';

export default function Card({ task }) {
  const dones = task.checklists.filter((list) => list.checked);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text
          style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}
          step={1}
          color="#767575"
          weight="500"
        >
          <span className={styles[task.priority]}>•</span>{' '}
          {task.priority.toUpperCase()} PRIORITY
        </Text>

        {task.assignee && (
          <div className={styles.assignee}>
            <Text step={1}>{task.assignee.substring(0, 2)}</Text>
          </div>
        )}
      </div>
      
        
      <div className={styles['card-title-container']}>
          <Text step={7} weight="500" className={styles['text-truncate']}>
            {task.title}
          </Text>
          <div className={styles.tooltip}>{task.title}</div>
      </div>
      
      <div className={styles.checklists}>
        <Text weight="500">
          Checklists ({dones.length + '/' + task.checklists.length})
        </Text>

        <div className={styles.lists}>
          {task.checklists.map((list) => (
            <div key={list.id} className={styles.list}>
              <div className={styles.checkboxContainer}>
                <input
                  type="checkbox"
                  name=""
                  id={`checkbox-${list.id}`}
                  checked={list.checked}
                />
              </div>
              
              <Text>{list.title}</Text>
            </div>
          ))}
        </div>
      </div>

      {task.dueDate && (
        <div className={styles.dueDate}>
          <Text weight="500">Due Date</Text>
          <Badge variant="error">
            {new Date(task.dueDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </Badge>
        </div>
      )}
    </div>
  );
}

Card.propTypes = {
  task: PropTypes.object,
};

