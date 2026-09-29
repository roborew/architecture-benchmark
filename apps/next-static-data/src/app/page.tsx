export default function Home() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside
        className="flex bg-navy px-4 py-3 text-slate-300 lg:flex-col lg:px-4 lg:py-7"
        aria-label="Main navigation"
      >
        Menu to go here
      </aside>
      <main className="bg-amber-50">Main pages to go here</main>
    </div>
  );
}
