import { useLocation } from "@tanstack/solid-router";
import { createEffect, createSignal } from "solid-js";
import { useDebouncedValue } from "@/hooks/use-debounced";
import { useQueryNavigation } from "@/hooks/use-query-navigation";

const inputClass =
	"w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

// Below this length a query matches most of the corpus and costs a round
// trip per keystroke, so it is not worth sending.
const MIN_LENGTH = 2;

export function SearchInput(props: {
	param?: string;
	placeholder?: string;
	label?: string;
}) {
	const param = () => props.param ?? "q";
	const placeholder = () => props.placeholder ?? "Search…";
	const label = () => props.label ?? "Search";

	const location = useLocation();
	const pathname = () => location().pathname ?? "/";
	const searchStr = () => location().searchStr ?? "";

	const navigateToQuery = useQueryNavigation(pathname());
	const searchParams = () => new URLSearchParams(searchStr());
	const urlQuery = () => searchParams().get(param()) ?? "";

	const [value, setValue] = createSignal(urlQuery());
	const debounced = useDebouncedValue(value, 300);
	const [isPending, setIsPending] = createSignal(false);

	// The query this component most recently pushed to the URL.
	let lastPushed: string | null = null;

	// Adopt the URL when it changes underneath us (back/forward, or a
	// shared link).
	createEffect(() => {
		const current = urlQuery();
		if (current === lastPushed) return;
		lastPushed = null;
		setValue(current);
	});

	createEffect(() => {
		// Still settling: acting now would push a stale, partial query.
		if (debounced() !== value()) return;

		const query = debounced().trim();
		if (query === urlQuery().trim()) return;
		if (query.length > 0 && query.length < MIN_LENGTH) return;

		const params = new URLSearchParams(searchStr());
		if (query) params.set(param(), query);
		else params.delete(param());

		lastPushed = query;
		setIsPending(true);
		// Replaces rather than pushes: typing a search should not fill the
		// history stack with one entry per query.
		navigateToQuery(params, { replace: true });
		setIsPending(false);
	});

	return (
		<label class="relative block">
			<span class="sr-only">{label()}</span>
			<span
				aria-hidden="true"
				class="pointer-events-none absolute left-3 top-2.5 text-slate-500"
			>
				⌕
			</span>
			<input
				type="search"
				value={value()}
				onInput={(e) => setValue(e.currentTarget.value)}
				placeholder={placeholder()}
				aria-busy={isPending()}
				class={inputClass}
			/>
		</label>
	);
}
