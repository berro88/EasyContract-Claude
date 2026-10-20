import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api.ts';

/** Loads a GET endpoint and exposes loading/error state plus a reload. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    setCode(null);
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) { setStatus(e.status); setCode(e.code ?? null); }
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, status, code, loading, reload: load };
}
