import type { ErrorComponentProps } from "@tanstack/react-router";

// The router hands an `unknown` to error boundaries; the display component
// wants an Error. Anything thrown that isn't an Error is still worth showing.
function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

// The root route's defaultErrorComponent: the safety net for a route that
// fails without an errorComponent of its own. It renders inside the shell so
// the template survives the failure — the router's alternative is to recreate
// the whole component tree from scratch.
export function RouteError({ error }: { error: Error }) {
	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
				Something went wrong
			</h1>
			<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
				The page could not be loaded: {error.message}
			</p>
		</div>
	);
}

// The route adapter; the component above stays router-free for unit tests.
export function RootRouteError({ error }: ErrorComponentProps) {
	return <RouteError error={toError(error)} />;
}
