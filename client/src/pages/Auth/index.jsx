import { Toaster } from 'react-hot-toast';
import { Outlet, useNavigate } from 'react-router-dom';
import astroBoy from '../../assets/astronut.png';
import { Text } from '../../components/ui';
import { useContext, useEffect } from 'react';

import { AuthContext } from '../../store/AuthProvider';

import styles from './index.module.css';

export default function AuthLayout() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  return (
    <>
      <Toaster
        position="bottom-right"
        reverseOrder={false}
        toastOptions={{
          style: {
            background: '#fff',
            color: 'black',
          },
        }}
      />

      <main className={styles.container}>
        <div className={styles.poster}>
          <div className={styles.image}>
            <div className={styles.circle}></div>
            <img src={astroBoy} alt="Astro boy" />
          </div>

          <Text color="white" step={8}>
            Welcome aboard my friend
          </Text>

          <Text color="white" step={4} style={{ marginTop: '0.5rem' }}>
            Just a couple of clicks and we start
          </Text>
        </div>

        <div className={styles.outlet}>
          <Outlet />
        </div>
      </main>
    </>
  );
}
