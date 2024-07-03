import PropTypes from 'prop-types';
import { Text, Button } from '../../../components/ui';
import { Link } from 'react-router-dom';

import styles from './Form.module.css';

export default function Form({ title, children }) {
  return (
    <div className={styles.container}>
      <Text step={7} weight="500">
        {title}
      </Text>

      {children}

      <div className={styles.navigation}>
        <Text color="#828282">
          {title === 'Register' ? 'Have an account ?' : 'Have no account yet?'}
        </Text>
        <Link to={title == 'Register' ? '..' : 'register'}>
          <Button variant="outline" >
            {title == 'Register' ? 'Login' : 'Register'}
          </Button>
        </Link>
      </div>
    </div>
  );
}

Form.propTypes = {
  title: PropTypes.oneOf(['Login', 'Register']).isRequired,
  children: PropTypes.node,
};
