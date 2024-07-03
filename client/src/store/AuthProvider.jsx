import { createContext, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { BACKEND_URL } from '../utils/connection';

export const AuthContext = createContext({
  user: {},
  login: () => {},
  logout: () => {}, 
  isLoading: true,
  updateInfo: async () => {},
});

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedUser = JSON.parse(localStorage.getItem('user'));
    if (savedUser) {
      setUser(savedUser);
    }
    setIsLoading(false);
  }, []);

  const login = (data) => {
    localStorage.setItem('user', JSON.stringify(data));
    setUser(data);
  };

  const logout = () => {
    localStorage.removeItem('user');
    setUser(null);
  };

  const updateInfo = async (shouldLogout = false) => {
    try {
      const res = await fetch(BACKEND_URL + '/api/v1/users', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + user.token,
        },
      });
  
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message);
      }
  
      const resObj = await res.json();
      const updatedUser = { ...user, info: resObj.data.info };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
  
      if (shouldLogout) {
        logout();
      }
    } catch (error) {
      console.log(error.message);
    }
  };
  

  return (
    <AuthContext.Provider
      value={{ user, login, logout, isLoading, updateInfo }}
    >
      {children}
    </AuthContext.Provider>
  );
}

AuthProvider.propTypes = {
  children: PropTypes.element,
};
