import { createEffect, createSignal } from "solid-js";

type valueCallBack<T> = () => T;
export function useDebouncedValue<T>(
	value: valueCallBack<T>,
	delay = 300,
): () => T {
	const [debounced, setDebounced] = createSignal(value());

	createEffect(() => {
		const timer = setTimeout(
			() => setDebounced(value() as valueCallBack<T>),
			delay,
		);
		// Clearing on every change is what makes this a debounce rather
		// than a throttle — and it guarantees the last value always wins.
		return () => clearTimeout(timer);
	});

	return debounced;
}
