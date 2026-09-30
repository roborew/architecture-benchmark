"use client";

import { useDebouncedValue } from "@/hooks/use-debounced";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export function SearchInput({
  placeholder,
  label,
}: {
  placeholder: string;
  label: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [value, setValue] = useState(urlQuery);
  const debounced = useDebouncedValue(value, 300);
  const [isPending, startTransition] = useTransition();

  // Keep the input in step when the URL changes underneath us
  // (back/forward buttons, or a shared link).
  useEffect(() => {
    if (!isPending) setValue(urlQuery);
  }, [urlQuery, isPending]);

  useEffect(() => {
    const query = debounced.trim();
    if (query === urlQuery.trim()) return;

    const params = new URLSearchParams(searchParams.toString());
    if (query) params.set("q", query);
    else params.delete("q");

    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/projects?${qs}` : "/projects", { scroll: false });
    });
  }, [debounced, urlQuery, searchParams, router]);

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
        className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}
