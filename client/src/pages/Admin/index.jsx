import { useContext, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';

import { AuthContext } from '../../store/AuthProvider';
import Navigation from './Navigation/Navigation';
import { AstroLoader, IconButton, OfflineBanner } from '../../components/ui';

import logo from '../../assets/logo.png';
import styles from './index.module.css';

export default function AdminLayout() {
  const { user, isLoading, isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [isNavOpen, setIsNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/auth', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Close the mobile drawer on navigation — leaving it open over the new page
  // is the classic drawer bug.
  useEffect(() => {
    setIsNavOpen(false);
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div className={styles.bootstrap}>
        <AstroLoader />
        <p>Loading your board…</p>
      </div>
    );
  }

  // The redirect above is in flight; rendering the app shell for an
  // unauthenticated user would let children read `user.token` of null.
  if (!isAuthenticated) return null;

  return (
    <div className={styles.shell}>
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

      {/* --- Mobile top bar (hidden from tablet up) --- */}
      <header className={styles.topbar}>
        <IconButton
          label={isNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setIsNavOpen((open) => !open)}
          aria-expanded={isNavOpen}
          aria-controls="primary-navigation"
        >
          <Menu />
        </IconButton>

        <span className={styles.topbarBrand}>
          <img src={logo} alt="" className={styles.topbarLogo} />
          Pro Manage
        </span>
      </header>

      {/* Backdrop only exists while the drawer is open on small screens. */}
      {isNavOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setIsNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        id="primary-navigation"
        className={`${styles.sidebar} ${isNavOpen ? styles.sidebarOpen : ''}`}
      >
        <Navigation user={user} onNavigate={() => setIsNavOpen(false)} />
      </div>

      <main className={styles.content}>
        <div className={styles.contentInner}>
          <Outlet />
        </div>
      </main>

      <OfflineBanner />
    </div>
  );
}
