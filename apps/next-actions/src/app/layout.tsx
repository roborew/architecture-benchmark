import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "./_components/app-shell";

// Every page reads live Postgres data, so nothing may be statically prerendered:
// the app must build and boot with no database reachable, then read at request
// time. This is also what lets the Docker image be built without a DB.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tasks Manager",
  description: "Task Manager",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-w-80 bg-slate-50 font-sans text-slate-800">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
