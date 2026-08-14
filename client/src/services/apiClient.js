/**
 * The single HTTP entry point for the app.
 *
 * Before this existed, every screen hand-rolled `fetch(BACKEND_URL + '/api/v1/...')`
 * with its own header block and its own error parsing, the base URL was
 * hardcoded to a production host, and nothing handled an expired session
 * centrally — each call site just showed its own toast.
 */

/** Trailing slashes are stripped so `${BASE_URL}${path}` never doubles up. */
const BASE_URL = String(import.meta.env.VITE_API_URL || 'http://localhost:3003').replace(
  /\/+$/,
  ''
);

const API_PREFIX = '/api/v1';

/**
 * An error carrying the API's structured response.
 *
 * `errors` is the field -> message map the backend returns for validation
 * failures, so forms can attach messages to the right input instead of
 * flattening everything into one toast.
 */
export class ApiError extends Error {
  constructor(message, { status, errors, isSessionExpired = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors || null;
    this.isSessionExpired = isSessionExpired;
  }
}

// --- Wiring ----------------------------------------------------------------
// AuthProvider injects these at mount. Keeping them as module state (rather
// than importing the context here) avoids a circular dependency between the
// provider and the client it uses.

let getToken = () => null;
let onUnauthorized = () => {};

export function configureApiClient(handlers = {}) {
  if (handlers.getToken) getToken = handlers.getToken;
  if (handlers.onUnauthorized) onUnauthorized = handlers.onUnauthorized;
}

/**
 * Guard against a burst of parallel 401s (the board fires several requests at
 * once) each triggering its own logout and its own "session expired" message.
 */
let isHandlingUnauthorized = false;

const handleUnauthorized = () => {
  if (isHandlingUnauthorized) return;

  isHandlingUnauthorized = true;
  try {
    onUnauthorized();
  } finally {
    // Release on the next tick: any 401s already in flight are part of the
    // same expiry event and should be swallowed, but a later session should
    // still be able to expire normally.
    setTimeout(() => {
      isHandlingUnauthorized = false;
    }, 0);
  }
};

/** Parse a response body as JSON, tolerating empty ones (204, and errors from proxies). */
const parseBody = async (res) => {
  if (res.status === 204) return null;

  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body means something between us and the API failed — a proxy
    // error page, a cold-start timeout. Surface it as a readable message
    // rather than a JSON parse exception.
    return { message: text.slice(0, 200) };
  }
};

async function request(method, path, { body, auth = true, signal, query } = {}) {
  const url = new URL(`${BASE_URL}${API_PREFIX}${path}`);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // An aborted request is a caller decision, not a failure to report.
    if (err.name === 'AbortError') throw err;

    throw new ApiError(
      navigator.onLine === false
        ? 'You appear to be offline. Check your connection and try again.'
        : 'Could not reach the server. Please try again.',
      { status: 0 }
    );
  }

  const payload = await parseBody(res);

  if (res.ok) return payload;

  if (res.status === 401 && auth) {
    // The session is gone: clear it once, centrally, and tell the caller not
    // to raise its own error UI on top of the redirect.
    handleUnauthorized();
    throw new ApiError('Your session has expired. Please log in again.', {
      status: 401,
      isSessionExpired: true,
    });
  }

  throw new ApiError(payload?.message || 'Something went wrong. Please try again.', {
    status: res.status,
    errors: payload?.errors,
  });
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
};

export { BASE_URL };
