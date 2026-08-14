import { useEffect, useState } from 'react';

/**
 * Browser connection status.
 *
 * Extracted from OfflineBanner so the sidebar's status light and the banner
 * read the same source rather than each wiring up its own listeners — two
 * indicators disagreeing about whether you are online would be worse than
 * having only one.
 */
export default function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' || navigator.onLine !== false
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
