import { Link } from "@tanstack/react-router";

// The root route's notFoundComponent: a URL that matches no route (a typo, a
// stale link, or a not-yet-built page navigated from the menu) renders this
// inside the shell rather than the router's bare fallback.
export function NotFoundPage() {
	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
				Page not found
			</h1>
			<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
				The page you were looking for does not exist.
			</p>
			<Link
				to="/"
				className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
			>
				Back to Dashboard
			</Link>
		</div>
	);
}
