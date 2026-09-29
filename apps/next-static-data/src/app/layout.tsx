import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "./_components/navigation";

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
      <body className="w-full h-full bg-white">
        <aside
          className="flex bg-navy px-4 py-3 text-slate-300 lg:flex-col lg:px-4 lg:py-7"
          aria-label="Main navigation"
        >
          <Navigation />
        </aside>
        <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
          <main className="bg-amber-50">{children}</main>
        </div>
      </body>
    </html>
  );
}
