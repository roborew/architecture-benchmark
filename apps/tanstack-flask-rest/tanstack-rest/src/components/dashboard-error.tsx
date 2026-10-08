import type { ErrorComponentProps } from "@tanstack/react-router";

// The router hands an `unknown` to error boundaries; the display components
// want an Error. Anything thrown that isn't an Error is still worth showing.
function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

// The / route's errorComponent: the loader's dashboard query failed (the API
// unreachable, or a 5xx), so the error renders INSIDE the page template
// instead of tearing the route tree down to a blank screen.
export function DashboardError({ error }: { error: Error }) {
	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
				Could not load the dashboard.
			</h1>
			<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
				The dashboard could not be fetched: {error.message}
			</p>
			<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
				Is the API server running? Start it from{" "}
				<code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
					apps/tanstack-flask-rest/flask-rest
				</code>{" "}
				with{" "}
				<code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
					.venv/bin/python -m src.server
				</code>
				.
			</p>
		</div>
	);
}

// The route adapter; the component above stays router-free for unit tests.
export function DashboardRouteError({ error }: ErrorComponentProps) {
	return <DashboardError error={toError(error)} />;
}
