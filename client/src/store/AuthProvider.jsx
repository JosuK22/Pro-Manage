import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';

import { configureApiClient, userApi } from '../services';

const STORAGE_KEY = 'user';

export const AuthContext = createContext({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
  updateInfo: async () => {},
});

/**
 * Read the persisted session.
 *
 * Storage can hold anything — a half-written value, a leftover from an older
 * shape, or something a user pasted in by hand. A throw here used to take the
 * whole app down on load, so every failure mode resolves to "signed out".
 */
const readStoredUser = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // A session is only usable if it actually carries a token.
    if (!parsed || typeof parsed !== 'object' || typeof parsed.token !== 'string') {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

/**
 * Decode a JWT's expiry without verifying it.
 *
 * This is a UX optimisation only — it lets the app skip a request it knows
 * will 401. The server remains the sole authority on whether a token is valid;
 * nothing here can be trusted for access control.
 */
const isTokenExpired = (token) => {
  try {
    const [, payload] = token.split('.');
    if (!payload) return false;

    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!exp) return false;

    return Date.now() >= exp * 1000;
  } catch {
    // Undecodable payload: let the server decide.
    return false;
  }
};

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // The API client reads the token through a ref so it always sees the current
  // value; passing `user` directly would capture whatever it was at mount.
  const userRef = useRef(null);
  userRef.current = user;

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const login = useCallback((data) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    setUser(data);
  }, []);

  /**
   * Central session-expiry handling.
   *
   * Any 401 from any request lands here exactly once (the client de-duplicates
   * bursts): the session is cleared, one message is shown, and the route
   * guards in AdminLayout take care of the redirect. Individual screens no
   * longer each pop their own error.
   */
  const handleUnauthorized = useCallback(() => {
    // Only announce an expiry if there was a session to lose — a 401 while
    // already signed out is not news.
    if (userRef.current) {
      toast.error('Your session has expired. Please log in again.');
    }
    logout();
  }, [logout]);

  // Registered before the first render commits, so no request can fire without
  // a token getter in place.
  useMemo(() => {
    configureApiClient({
      getToken: () => userRef.current?.token ?? null,
      onUnauthorized: handleUnauthorized,
    });
  }, [handleUnauthorized]);

  useEffect(() => {
    const stored = readStoredUser();

    if (stored && isTokenExpired(stored.token)) {
      // Don't hydrate a session that is already dead: doing so briefly renders
      // the app as signed in, then bounces the user out on the first request.
      localStorage.removeItem(STORAGE_KEY);
      setUser(null);
    } else {
      setUser(stored);
    }

    setIsLoading(false);
  }, []);

  /** Re-read the signed-in user's profile and refresh local state. */
  const updateInfo = useCallback(async () => {
    const res = await userApi.getProfile();

    setUser((current) => {
      if (!current) return current;

      const updated = { ...current, info: res.data.info };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user?.token),
      login,
      logout,
      updateInfo,
    }),
    [user, isLoading, login, logout, updateInfo]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = {
  children: PropTypes.node,
};
