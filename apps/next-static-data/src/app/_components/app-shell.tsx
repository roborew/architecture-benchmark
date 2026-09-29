"use client";

import { usePathname } from "next/navigation";
import Navigation from "./navigation";
import { AppHeader } from "./app-header";
import { resolvePageTitle } from "@/lib/nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside
        className="flex bg-navy-950 px-4 py-3 text-slate-300 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-62 lg:flex-col lg:px-4 lg:py-7"
        aria-label="Main navigation"
      >
        <Navigation />
        <div className="mt-auto hidden border-t border-slate-600 px-3 pt-4 text-[11px] leading-5 text-slate-300 lg:block">
          <strong className="block text-[12px] text-white">
            Style reference
          </strong>
          Static Tailwind examples for the CRUD benchmark applications.
        </div>
      </aside>

      <main className="min-w-0 lg:col-start-2">
        <AppHeader title={resolvePageTitle(pathname)} />
        {children}
      </main>
    </div>
  );
}
