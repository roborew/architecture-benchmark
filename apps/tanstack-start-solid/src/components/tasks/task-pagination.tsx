import { useLocation } from "@tanstack/solid-router";
import { For } from "solid-js";

import { useQueryNavigation } from "@/hooks/use-query-navigation";
import { PAGE_SIZES } from "@/lib/pagination";

function toParams(search: Record<string, string>): URLSearchParams {
	return new URLSearchParams(search);
}

function withoutCursor(search: Record<string, string>): URLSearchParams {
	const params = toParams(search);
	params.delete("page");
	params.delete("cursor");
	return params;
}

export function TaskPagination(props: {
	hasNewer: boolean;
	hasOlder: boolean;
	firstSearch: Record<string, string>;
	nextSearch: Record<string, string>;
	size: number;
}) {
	const navigateToQuery = useQueryNavigation("/tasks");

	const location = useLocation();
	const currentParams = () => new URLSearchParams(location().searchStr ?? "");

	return (
		<div class="flex items-center gap-3">
			<label class="flex items-center gap-1.5 text-[11px] text-slate-500">
				Per page
				<select
					aria-label="Tasks per page"
					value={String(props.size)}
					onChange={(event) => {
						const params = new URLSearchParams(currentParams());
						params.delete("page");
						params.delete("cursor");
						params.set("size", event.currentTarget.value);
						navigateToQuery(params);
					}}
					class="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-brand-500"
				>
					<For each={PAGE_SIZES}>
						{(option) => <option value={option}>{option}</option>}
					</For>
				</select>
			</label>

			<div class="flex gap-2">
				<button
					type="button"
					disabled={!props.hasNewer}
					onClick={() => navigateToQuery(withoutCursor(props.firstSearch))}
					class="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Previous
				</button>
				<button
					type="button"
					disabled={!props.hasOlder}
					onClick={() => navigateToQuery(toParams(props.nextSearch))}
					class="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Next
				</button>
			</div>
		</div>
	);
}
