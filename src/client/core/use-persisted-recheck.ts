import { useEffect, useState } from 'react';
import { persistRecheck, readRecheck } from './write-recheck';

export function usePersistedRecheck<T>(key: string, validate: (value: unknown) => value is T) {
  const read = () => readRecheck(key, value => validate(value) ? value : null);
  const [receipt, setReceipt] = useState<{key: string; value: T | null}>(() => ({ key, value: read() }));
  useEffect(() => { setReceipt({ key, value: readRecheck(key, value => validate(value) ? value : null) }); }, [key, validate]);
  const setValue = (value: T | null) => {
    persistRecheck(key, value);
    setReceipt({ key, value });
  };
  // A late callback from a previous scope must not expose its receipt in this scope.
  return [receipt.key === key ? receipt.value : read(), setValue] as const;
}
