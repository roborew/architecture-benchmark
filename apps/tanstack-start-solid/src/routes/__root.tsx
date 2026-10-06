import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/solid-router";

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
  shellComponent: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" class="h-full antialiased">
      <head>
        <HeadContent />
      </head>
      <body class="min-w-80 bg-slate-50 font-sans text-slate-800">
        <AppShell>
          <Outlet />
        </AppShell>
        <Scripts />
      </body>
    </html>
  );
}
