import { useContext } from 'react';

import { TasksContext } from '../../../../store/TaskProvider';
import Container from '../CardsContainer/Container';

import styles from './TaskContainer.module.css';

const categories = [
  { id: 1, title: 'Backlog', value: 'backlog' },
  { id: 2, title: 'To do', value: 'todo' },
  { id: 3, title: 'In progress', value: 'inProgress' },
  { id: 4, title: 'Done', value: 'done' },
];

export default function TasksContainer() {
  const { tasks, isLoading } = useContext(TasksContext);
  let content;

  if (isLoading) {
    content = <p>Loading...</p>;
  }

  if (tasks) {
    content = (
      <div className={styles.categories}>
        {categories.map((category) => (
          <Container tasks={tasks} key={category.id} category={category} />
        ))}
      </div>
    );
  }

  return <div className={styles.container}>{content}</div>;
}
