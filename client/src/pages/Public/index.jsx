import { useParams } from 'react-router-dom';
import logo from '../../assets/logo.png';
import useFetch from '../../hooks/useFetch';
import PublicCard from './PublicCard/PublicCard';
import { Text , AstroLoader} from '../../components/ui';
import { BACKEND_URL } from '../../utils/connection';
import styles from './index.module.css';


export default function PublicLayout() {
  const { taskId } = useParams();
  const url = BACKEND_URL + '/api/v1/tasks/' + taskId;
  const { data, isLoading, error } = useFetch(url);

  let content;

  if (isLoading) {
    content = <AstroLoader/>;
  }

  if (error) {
    content = <p>{error.message}</p>;
  }

  if (data) {
    content = <PublicCard task={data.task} />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.logo}>
        <div className={styles.image}>
          <img src={logo} alt="Pro manage" />
        </div>

        <div className={styles.title}>
          <Text step={4} weight='600'>Pro Manage</Text>
        </div>
      </div>

      <main>{content}</main>
    </div>
  );
}
