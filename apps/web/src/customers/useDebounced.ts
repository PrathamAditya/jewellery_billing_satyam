import { useEffect, useState } from "react";

/** The value, but only after it has stopped changing for `ms`. Keeps search-as-you-type from firing on every key. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}
