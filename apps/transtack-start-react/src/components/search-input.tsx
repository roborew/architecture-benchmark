import { useRouter, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState, useTransition } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced";

const inputClass =
  "w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

// Below this length a query matches most of the corpus and costs a round
// trip per keystroke, so it is not worth sending.
const MIN_LENGTH = 2;

export function SearchInput({
  param = "q",
  placeholder = "Search…",
  label = "Search",
}: {
  param?: string;
  placeholder?: string;
  label?: string;
}) {
  const router = useRouter();
  const { pathname, searchStr } = useLocation();
  // The param name is a prop, so the query is read off the raw search string
  // rather than a statically-typed `useSearch()` object.
  const searchParams = new URLSearchParams(searchStr);
  const urlQuery = searchParams.get(param) ?? "";

  const [value, setValue] = useState(urlQuery);
  const debounced = useDebouncedValue(value, 300);
  const [isPending, startTransition] = useTransition();

  // The query this component most recently pushed to the URL. Lets the
  // effect below tell its own echo apart from a genuine external change.
  const lastPushed = useRef<string | null>(null);

  // Adopt the URL when it changes underneath us (back/forward, or a
  // shared link). Skipping our own echo matters: the URL is trimmed, so
  // re-reading it here would delete a trailing space mid-keystroke and
  // collapse "alpha beta" into "alphabeta" as it is typed.
  useEffect(() => {
    if (urlQuery === lastPushed.current) return;
    lastPushed.current = null;
    setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    // Still settling: acting now would push a stale, partial query.
    if (debounced !== value) return;

    const query = debounced.trim();
    if (query === urlQuery.trim()) return;
    if (query.length > 0 && query.length < MIN_LENGTH) return;

    const params = new URLSearchParams(searchStr);
    if (query) params.set(param, query);
    else params.delete(param);

    const qs = params.toString();
    lastPushed.current = query;
    startTransition(() => {
      router.navigate({
        to: qs ? `${pathname}?${qs}` : pathname,
        replace: true,
        resetScroll: false,
      });
    });
  }, [debounced, value, urlQuery, param, pathname, searchStr, router]);

  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-2.5 text-slate-500"
      >
        ⌕
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-busy={isPending}
        className={inputClass}
      />
    </label>
  );
}
