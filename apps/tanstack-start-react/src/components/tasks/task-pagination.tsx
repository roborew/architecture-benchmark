import { useLocation } from "@tanstack/react-router";

import { useQueryNavigation } from "@/hooks/use-query-navigation";

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
/**
 * Splits a structured search object into the URLSearchParams the navigation
 * helper takes.
 */
function toParams(search: Record<string, string>): URLSearchParams {
  return new URLSearchParams(search);
}

/** The first page of a filter set: the filters, with paging dropped. */
function withoutCursor(search: Record<string, string>): URLSearchParams {
  const params = toParams(search);

  params.delete("page");
  params.delete("cursor");

  return params;
}

export function TaskPagination({
  hasNewer,
  hasOlder,
  firstSearch,
  nextSearch,
  size,
}: {
  hasNewer: boolean;
  hasOlder: boolean;
  /** Search params for "Previous": the current filters, cursor dropped. */
  firstSearch: Record<string, string>;
  /** Search params for "Next": the current filters plus the new cursor. */
  nextSearch: Record<string, string>;
  /** Page size currently applied. */
  size: number;
}) {
  const navigateToQuery = useQueryNavigation("/tasks");

  // The filters this control preserves come from the live URL, not from the
  // `firstSearch` prop.
  //
  // The prop is built by the loader, and on a client-side navigation the URL
  // updates before the new loader result renders — so for a moment after any
  // filter change this component is still holding the *previous* route's
  // filters. Choosing a page size in that window built the new URL from them
  // and silently dropped the filter the user had just applied. Reading the URL
  // makes the control correct at every instant, whether or not a re-render has
  // landed yet.
  const { search } = useLocation();
  const currentParams = new URLSearchParams(search);

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
            const params = new URLSearchParams(currentParams);

            // A stale `page`/`cursor` from the current URL must not carry over:
            // the new size belongs to page one of the same filters.
            params.delete("page");
            params.delete("cursor");
            params.set("size", event.target.value);

            navigateToQuery(params);
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
          onClick={() => navigateToQuery(withoutCursor(firstSearch))}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!hasOlder}
          onClick={() => navigateToQuery(toParams(nextSearch))}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
