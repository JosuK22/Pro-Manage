import PropTypes from 'prop-types';

import { Text } from '../../../../components/ui';

import styles from './Checklilst.module.css';

export default function Checklist({ list, onChange }) {
  return (
    <div className={styles.container}>
      
      <div>
        <input type="checkbox" checked={list.checked} onChange={(e) => onChange(list._id, e.target.checked)}/>
      </div>
      
      <Text>{list.title}</Text>
    </div>
  );
}

Checklist.propTypes = {
  list: PropTypes.object,
  onChange: PropTypes.func,
};
