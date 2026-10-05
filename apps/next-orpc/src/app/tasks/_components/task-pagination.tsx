"use client";

import { useRouter } from "next/navigation";

import { PAGE_SIZES } from "@/lib/pagination";

/**
 * Keyset pagination controls for the workspace task list.
 *
 * Buttons rather than links, so each can be disabled when there is nothing in
 * that direction — an enabled-looking dead control is worse than a greyed-out
 * one.
 *
 * The hrefs are computed by the server, which owns the filters and the cursor;
 * this only navigates. "Previous" returns to the first page of the current
 * filter rather than stepping back a cursor, because a keyset walk only moves
 * forward and the earlier cursors are no longer on the page.
 */
export function TaskPagination({
  hasNewer,
  hasOlder,
  firstHref,
  nextHref,
  size,
}: {
  hasNewer: boolean;
  hasOlder: boolean;
  firstHref: string;
  nextHref: string;
  /** Page size currently applied. */
  size: number;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        Per page
        <select
          aria-label="Tasks per page"
          value={String(size)}
          onChange={(event) => {
            // Changing the size invalidates the cursor, so go back to the first
            // page of the same filters rather than paging on from here.
            const separator = firstHref.includes("?") ? "&" : "?";
            router.push(`${firstHref}${separator}size=${event.target.value}`);
          }}
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-brand-500"
        >
          {PAGE_SIZES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!hasNewer}
          onClick={() => router.push(firstHref)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!hasOlder}
          onClick={() => router.push(nextHref)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
