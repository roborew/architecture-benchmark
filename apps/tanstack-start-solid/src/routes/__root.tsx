import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { HydrationScript } from "solid-js/web";

import { AppShell } from "@/components/app-shell";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Tasks Manager",
			},
			{
				name: "description",
				content: "Task Manager",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	notFoundComponent: () => (
		<div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
				Page not found
			</h1>
			<p class="mt-1.5 text-[13px] leading-6 text-slate-500">
				The page you are looking for does not exist.
			</p>
		</div>
	),
	// shellComponent is the static HTML document shell. It must NOT contain
	// reactive router state (useLocation, useMatches, etc.) because Solid
	// re-renders the entire shell when those signals change, causing infinite
	// render loops and app freezing.
	shellComponent: RootDocument,
	// The AppShell layout lives in the route tree via `component`, where it
	// can safely read router state without re-rendering the HTML document.
	component: RootLayout,
});

/** Static HTML document shell — no reactive router state.
 *
 * The route tree (including RootLayout/AppShell below) arrives via
 * `props.children`. An `<Outlet />` must NOT be used here: inside the shell
 * it skips the root route's `component` and renders the matched leaf route
 * directly, dropping the AppShell (sidebar menu and header) entirely.
 */
function RootDocument(props: { children?: JSX.Element }) {
	return (
		<html lang="en" class="h-full antialiased">
			<head>
				<HydrationScript />
				<HeadContent />
			</head>
			<body class="min-w-80 bg-slate-50 font-sans text-slate-800">
				{props.children}
				<Scripts />
			</body>
		</html>
	);
}

/** Route-tree layout — safe to use reactive router hooks here. */
function RootLayout() {
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}
