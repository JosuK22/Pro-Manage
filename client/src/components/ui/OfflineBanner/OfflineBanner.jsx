import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

import useOnlineStatus from '../../../hooks/useOnlineStatus';

import styles from './OfflineBanner.module.css';

/** How long the "connection restored" confirmation stays before it retires. */
const RESTORED_MS = 3200;

/**
 * Persistent, unobtrusive notice while the browser reports no connection.
 *
 * Shown as a banner rather than a toast because the condition lasts until it
 * is fixed — a toast would disappear while the problem is still there.
 *
 * Reconnecting now shows a brief confirmation rather than the banner simply
 * vanishing: silently disappearing leaves the user unsure whether the app
 * recovered or they just stopped noticing the warning.
 */
export default function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [showRestored, setShowRestored] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      setShowRestored(false);
      return undefined;
    }

    // Only confirm a recovery if there was an outage to recover from.
    if (!wasOffline.current) return undefined;

    wasOffline.current = false;
    setShowRestored(true);

    const timer = setTimeout(() => setShowRestored(false), RESTORED_MS);
    return () => clearTimeout(timer);
  }, [isOnline]);

  if (isOnline && !showRestored) return null;

  const restored = isOnline;

  return (
    // `polite` so it is announced without interrupting whatever the user is doing.
    <div
      className={`${styles.banner} ${restored ? styles.restored : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.light} aria-hidden="true" />

      {restored ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}

      <span className={styles.label}>
        {restored ? 'Connection restored' : 'Connection lost'}
      </span>

      {!restored && (
        <span className={styles.detail}>
          You’re offline. Changes may not sync until you’re connected again.
        </span>
      )}
    </div>
  );
}
