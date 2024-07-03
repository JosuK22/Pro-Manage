import { useState } from 'react';
import { CopyMinus, Plus } from 'lucide-react';
import PropTypes from 'prop-types';

import { Modal, Text } from '../../../../components/ui';
import useModal from '../../../../hooks/useModal';
import Card from '../Card/Card';
import TaskForm from '../TaskForm/TaskForm';

import styles from './Container.module.css';

export default function Container({ tasks, category }) {
  const { isOpen: isCreateOpen, toggleModal: toggleCreateModal } = useModal();
  const [openDisclosures, setOpenDisclosures] = useState([]);

  const closeDisclosure = (id) => {
    setOpenDisclosures(
      openDisclosures.filter((disclosure) => disclosure !== id)
    );
  };

  const openDisclosure = (id) => {
    const updatedDisclosures = [...openDisclosures, id];
    setOpenDisclosures(updatedDisclosures);
  };

  const toggleDisclosure = (id) => {
    if (openDisclosures.includes(id)) {
      closeDisclosure(id);
    } else {
      openDisclosure(id);
    }
  };

  const closeAllDisclosure = () => {
    setOpenDisclosures([]);
  };

  return (
    <>
      <div className={styles.container}>
        <div className={styles.heading}>
          <Text step={4} weight="500">
            {category.title}
          </Text>
          <div className={styles.icons}>
            {category.title == 'To do' && (
              <Plus size={20} color="#767575" onClick={toggleCreateModal} />
            )}
            <CopyMinus
              size={20}
              color={openDisclosures.length ? '#17a2b8' : '#767575'}
              onClick={closeAllDisclosure}
              style={{ transform: 'scaleX(-1)' }} 
            />
          </div>
        </div>
        
        <div className={styles.scroll}>
          <div className={styles.tasks}>
          
            {tasks.map((task) => {
              if (task.status == category.value) {
                return (
                  <Card
                    key={task._id}
                    task={task}
                    isOpen={openDisclosures?.includes(task._id)}
                    toggleDisclosure={() => toggleDisclosure(task._id)}
                  />
                );
              }
            })}
          </div>
       </div>
      </div>
      {isCreateOpen && (
        <Modal toggleModal={toggleCreateModal}>
          <TaskForm toggleModal={toggleCreateModal} />
        </Modal>
      )}
    </>
  );
}

Container.propTypes = {
  tasks: PropTypes.array,
  category: PropTypes.object,
};
