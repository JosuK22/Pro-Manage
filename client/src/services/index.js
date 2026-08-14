/**
 * Endpoint definitions.
 *
 * Screens call these instead of building URLs, so a route change touches one
 * line here rather than every component that happened to fetch it.
 */

import { api } from './apiClient';

export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials, { auth: false }),
  register: (details) => api.post('/auth/register', details, { auth: false }),
};

export const userApi = {
  getProfile: () => api.get('/users'),
  updateProfile: (updates) => api.patch('/users', updates),
};

export const taskApi = {
  list: ({ range, status, priority, signal } = {}) =>
    api.get('/tasks', { query: { range, status, priority }, signal }),

  /** Public share link — deliberately unauthenticated. */
  getPublic: (taskId, { signal } = {}) =>
    api.get(`/tasks/${taskId}`, { auth: false, signal }),

  create: (task) => api.post('/tasks', task),
  update: (taskId, updates) => api.patch(`/tasks/${taskId}`, updates),
  remove: (taskId) => api.delete(`/tasks/${taskId}`),

  analytics: ({ signal } = {}) => api.get('/tasks/analytics', { signal }),
};

export const assigneeApi = {
  list: ({ signal } = {}) => api.get('/assignees', { signal }),
  create: (email) => api.post('/assignees', { email }),
};

export { api, ApiError, configureApiClient, BASE_URL } from './apiClient';
