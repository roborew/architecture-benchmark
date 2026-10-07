import type { ErrorComponentProps } from "@tanstack/react-router";

// The router hands an `unknown` to error boundaries; the display components
// want an Error. Anything thrown that isn't an Error is still worth showing.
function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

// The projects routes' errorComponent: a loader's project query failed (the
// API unreachable, or a 5xx), so the error renders INSIDE the page template
// instead of tearing the route tree down to a blank screen. A missing project
// is NOT an error — the board and edit routes render their own inline
// not-found state for that.
export function ProjectsError({ error }: { error: Error }) {
	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
				Could not load projects.
			</h1>
			<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
				The projects could not be fetched: {error.message}
			</p>
			<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
				Is the API server running? Start it from{" "}
				<code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
					apps/tanstack-fastapi-rest/fastapi-rest
				</code>{" "}
				with{" "}
				<code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
					pnpm dev
				</code>
				.
			</p>
		</div>
	);
}

// The route adapter; the component above stays router-free for unit tests.
export function ProjectsRouteError({ error }: ErrorComponentProps) {
	return <ProjectsError error={toError(error)} />;
}
