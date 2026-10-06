import { createEffect, createSignal } from "solid-js";

export function useDebouncedValue<T>(value: () => T, delay = 300): () => T {
  const [debounced, setDebounced] = createSignal(value());

  createEffect(() => {
    const timer = setTimeout(() => setDebounced(value()), delay);
    // Clearing on every change is what makes this a debounce rather
    // than a throttle — and it guarantees the last value always wins.
    return () => clearTimeout(timer);
  });

  return debounced;
}
