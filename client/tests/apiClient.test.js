import { describe, it, expect, vi, beforeEach } from 'vitest';

import { api, ApiError, configureApiClient } from '../src/services/apiClient';

/** Build a fetch stand-in that resolves to one scripted response. */
const mockResponse = ({ status = 200, body = null, ok } = {}) => ({
  ok: ok ?? (status >= 200 && status < 300),
  status,
  text: async () => (body === null ? '' : JSON.stringify(body)),
});

describe('apiClient', () => {
  beforeEach(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  });

  it('attaches a bearer token when one is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ body: { status: 'success', data: {} } })
    );
    vi.stubGlobal('fetch', fetchMock);
    configureApiClient({ getToken: () => 'a-token' });

    await api.get('/tasks');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer a-token');
  });

  it('omits the auth header for explicitly public requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ body: { status: 'success', data: {} } })
    );
    vi.stubGlobal('fetch', fetchMock);
    configureApiClient({ getToken: () => 'a-token' });

    await api.get('/tasks/abc', { auth: false });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('serialises query parameters and skips empty ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ body: { status: 'success', data: {} } })
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/tasks', { query: { range: 'week', status: undefined, priority: '' } });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('range=week');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('priority=');
  });

  it('surfaces the API message and field errors on a validation failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse({
          status: 400,
          body: { status: 'fail', message: 'Invalid', errors: { title: 'Required' } },
        })
      )
    );

    await expect(api.post('/tasks', {})).rejects.toMatchObject({
      message: 'Invalid',
      status: 400,
      errors: { title: 'Required' },
    });
  });

  it('returns null for a 204 rather than trying to parse an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ status: 204 })));

    await expect(api.delete('/tasks/abc')).resolves.toBeNull();
  });

  it('reports a readable error when the server returns non-JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '<html>Bad Gateway</html>',
      })
    );

    // A proxy error page must not surface as a JSON parse exception.
    await expect(api.get('/tasks')).rejects.toBeInstanceOf(ApiError);
  });

  it('reports an offline-specific message when the network is unreachable', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(api.get('/tasks')).rejects.toMatchObject({
      message: expect.stringMatching(/offline/i),
      status: 0,
    });
  });

  it('rethrows an AbortError untouched so callers can ignore cancellations', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(api.get('/tasks')).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('session expiry', () => {
    it('calls onUnauthorized once and flags the error', async () => {
      const onUnauthorized = vi.fn();
      configureApiClient({ getToken: () => 'stale-token', onUnauthorized });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse({ status: 401, body: { status: 'fail', message: 'Expired' } })
        )
      );

      await expect(api.get('/tasks')).rejects.toMatchObject({
        status: 401,
        isSessionExpired: true,
      });

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('de-duplicates a burst of parallel 401s into a single logout', async () => {
      const onUnauthorized = vi.fn();
      configureApiClient({ getToken: () => 'stale-token', onUnauthorized });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse({ status: 401, body: { status: 'fail', message: 'Expired' } })
        )
      );

      // The board fires several requests at once; the user must not get four
      // "session expired" messages and four redirects.
      await Promise.allSettled([
        api.get('/tasks'),
        api.get('/tasks/analytics'),
        api.get('/assignees'),
      ]);

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('does not trigger a logout for a 401 on a public request', async () => {
      const onUnauthorized = vi.fn();
      configureApiClient({ getToken: () => null, onUnauthorized });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse({ status: 401, body: { status: 'fail', message: 'Nope' } })
        )
      );

      await expect(api.get('/tasks/abc', { auth: false })).rejects.toBeInstanceOf(ApiError);
      expect(onUnauthorized).not.toHaveBeenCalled();
    });
  });
});
