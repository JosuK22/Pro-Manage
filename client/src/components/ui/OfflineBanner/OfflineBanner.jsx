import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

import styles from './OfflineBanner.module.css';

/**
 * Persistent, unobtrusive notice while the browser reports no connection.
 *
 * Shown as a banner rather than a toast because the condition lasts until it
 * is fixed — a toast would disappear while the problem is still there. It
 * removes itself automatically when the connection returns.
 */
export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false
  );

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    // `polite` so it is announced without interrupting whatever the user is doing.
    <div className={styles.banner} role="status" aria-live="polite">
      <WifiOff size={16} aria-hidden="true" />
      <span>
        <strong>You’re offline.</strong> Changes may not be saved until your connection
        returns.
      </span>
    </div>
  );
}
