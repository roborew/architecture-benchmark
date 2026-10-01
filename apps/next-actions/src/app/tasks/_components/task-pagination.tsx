"use client";

import { useRouter } from "next/navigation";

/**
 * Keyset pagination controls for the workspace task list.
 *
 * Buttons rather than links, so each can be disabled when there is nothing in
 * that direction — a "Previous" link on the first page would go nowhere
 * useful, and an enabled-looking dead control is worse than a greyed-out one.
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
}: {
  hasNewer: boolean;
  hasOlder: boolean;
  firstHref: string;
  nextHref: string;
}) {
  const router = useRouter();

  return (
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
  );
}
