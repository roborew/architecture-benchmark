"use client";

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    // Clearing on every change is what makes this a debounce rather
    // than a throttle — and it guarantees the last value always wins.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
