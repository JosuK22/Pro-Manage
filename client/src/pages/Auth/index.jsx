import { useContext, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Outlet, useNavigate } from 'react-router-dom';

import astroBoy from '../../assets/astronut.png';
import { Text, OfflineBanner } from '../../components/ui';
import { AuthContext } from '../../store/AuthProvider';

import styles from './index.module.css';

export default function AuthLayout() {
  const { isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <>
      <Toaster
        position="top-center"
        reverseOrder={false}
        toastOptions={{
          style: {
            background: 'var(--surface)',
            color: 'var(--text)',
            boxShadow: 'var(--shadow-lg)',
          },
        }}
      />

      {/*
        The previous version measured window.innerWidth and, below 800px,
        replaced the entire app with "Sorry amigo — this website is for desktop
        only". Phones are the most likely device for a link like this, so the
        poster is now decorative: it is hidden on small screens while the form
        itself stays fully usable at 320px.
      */}
      <main className={styles.container}>
        <aside className={styles.poster} aria-hidden="true">
          <div className={styles.image}>
            <div className={styles.circle} />
            <img src={astroBoy} alt="" />
          </div>

          <Text as="p" color="white" step={8}>
            Welcome aboard my friend
          </Text>

          <Text as="p" color="white" step={4} style={{ marginTop: '0.5rem' }}>
            Just a couple of clicks and we start
          </Text>
        </aside>

        <div className={styles.outlet}>
          <Outlet />
        </div>
      </main>

      <OfflineBanner />
    </>
  );
}
