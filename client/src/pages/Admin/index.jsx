import { useContext, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Outlet, useNavigate } from 'react-router-dom';

import { AuthContext } from '../../store/AuthProvider';
import Navigation from './Navigation/Navigation';

import styles from './index.module.css';

export default function AdminLayout() {
  const { user, isLoading } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user && !isLoading) {
      navigate('/auth');
    }
  }, [user, isLoading, navigate]);

  return (
    <div>
      <Toaster
        position="top-center"
        reverseOrder={false}
        toastOptions={{
          style: {
            background: '#fff',
            color: 'black',
          },
        }}
      />

      {isLoading ? (
        <h1>Loading...</h1>
      ) : (
        <main className={styles.container}>
          <div className={styles.navigation}>
            <Navigation />
          </div>
          {user && (
            <div className={styles.outlet}>
              <Outlet />
            </div>
          )}
        </main>
      )}
    </div>
  );
}
