import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

export default function useFetch(url, options) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(url, options);

      if (!res.ok) {
        const errObj = await res.json();
        throw new Error(errObj.message);
      }

      const resObj = await res.json();
      setData(resObj.data);
    } catch (error) {
      setError(error);
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [url, options]);

  useEffect(() => {
    (async () => {
      await fetchData();
    })();
  }, [fetchData]);

  return { data, error, isLoading };
}
