import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

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
});

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
