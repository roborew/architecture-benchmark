export function AppHeader({ title }: { title: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-8">
      <div className="flex items-center gap-2 text-[12px] text-slate-500">
        <span>Demo workspace</span>
        <span aria-hidden="true">/</span>
        <strong
          id="page-title"
          data-testid="page-title"
          className="font-bold text-slate-700"
        >
          {title}
        </strong>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 sm:inline">
          Static example
        </span>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo-400 text-[10px] font-bold text-white">
          RA
        </span>
      </div>
    </header>
  );
}
