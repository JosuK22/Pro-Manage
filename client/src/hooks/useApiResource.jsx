import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Load a single resource, with explicit loading / error / retry state.
 *
 * Replaces the old `useFetch(url, options)`, which:
 *   - took an options object that had to be memoised by every caller or the
 *     effect looped forever,
 *   - raised a toast from inside the hook, so pages had no way to render a
 *     proper inline error, and
 *   - had no retry and no request cancellation.
 *
 * @param fetcher  receives `{ signal }`; must return the parsed response.
 * @param deps     re-runs the fetch when these change.
 */
export default function useApiResource(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Kept in a ref so `load` does not need the fetcher in its dependency list —
  // callers can pass an inline arrow without causing an infinite loop.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [reloadToken, setReloadToken] = useState(0);
  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetcherRef.current({ signal: controller.signal });
        if (active) setData(result);
      } catch (err) {
        if (!active || err.name === 'AbortError') return;

        // A dead session is handled centrally by the API client; showing a
        // page-level error on top of the redirect would just be noise.
        if (!err.isSessionExpired) setError(err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    load();

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { data, error, isLoading, retry };
}
