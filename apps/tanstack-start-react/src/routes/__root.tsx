import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";

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
  shellComponent: RootDocument,
  // Root-level boundary for URLs that match no route at all — a typo, a stale
  // link, or the stray probes a browser makes (favicon, Chrome DevTools'
  // `/.well-known/appspecific/com.chrome.devtools.json`). Without it TanStack
  // Router logs a warning and falls back to its bare `<p>Not Found</p>`.
  notFoundComponent: RootNotFound,
});

function RootNotFound() {
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

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <HeadContent />
      </head>
      {/* The shell carries the page chrome — sidebar, header, title — and
          wraps every route, replacing Next's root layout. */}
      <body className="min-w-80 bg-slate-50 font-sans text-slate-800">
        <AppShell>{children}</AppShell>
        <Scripts />
      </body>
    </html>
  );
}
