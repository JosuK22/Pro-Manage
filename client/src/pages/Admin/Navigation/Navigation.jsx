import { useContext } from 'react';
import PropTypes from 'prop-types';
import { Database, LogOut, PanelsTopLeft, Settings } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

import { Button, Text, Modal, Avatar } from '../../../components/ui';
import { AuthContext } from '../../../store/AuthProvider';
import useModal from '../../../hooks/useModal';

import logo from '../../../assets/logo.png';

import styles from './Navigation.module.css';

const LINKS = [
  { to: '/', label: 'Board', icon: PanelsTopLeft, end: true },
  { to: '/analytics', label: 'Analytics', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Navigation({ user, onNavigate }) {
  const { logout } = useContext(AuthContext);
  const { isOpen, toggleModal } = useModal();

  return (
    <>
      <div className={styles.container}>
        <Link to="/" className={styles.logo} onClick={onNavigate}>
          <img src={logo} alt="" className={styles.logoImage} />
          <Text as="span" step={4} weight="800">
            Pro Manage
          </Text>
        </Link>

        {/* A real <nav> landmark: screen-reader users can jump straight here. */}
        <nav className={styles.nav} aria-label="Main">
          <ul className={styles.links}>
            {LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `${styles.link} ${isActive ? styles.active : ''}`
                  }
                >
                  {/* `aria-current="page"` is added by NavLink automatically,
                      so the active item is announced, not just coloured. */}
                  <link.icon size={20} aria-hidden="true" className={styles.icon} />
                  <span>{link.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.footer}>
          {user?.info && (
            <div className={styles.account}>
              <Avatar email={user.info.email} size="md" />
              <div className={styles.accountText}>
                <span className={styles.accountName}>{user.info.name}</span>
                <span className={styles.accountEmail}>{user.info.email}</span>
              </div>
            </div>
          )}

          {/* Was a clickable <div>: unreachable by keyboard, and not announced
              as a control. */}
          <button type="button" onClick={toggleModal} className={styles.logout}>
            <LogOut size={20} aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      </div>

      {isOpen && (
        <Modal toggleModal={toggleModal} title="Log out" size="sm">
          <div className={styles.logoutContent}>
            <Text>Are you sure you want to log out of Pro Manage?</Text>

            <div className={styles.logoutActions}>
              <Button onClick={logout}>Yes, log out</Button>
              <Button variant="outline" color="error" onClick={toggleModal}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

Navigation.propTypes = {
  user: PropTypes.object,
  onNavigate: PropTypes.func,
};
