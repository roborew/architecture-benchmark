import { Link, useLocation } from "@tanstack/react-router";

import { NAV_ITEMS, isActivePath } from "@/lib/nav";

const linkClass =
  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold text-slate-300 transition hover:bg-navy-800 hover:text-white lg:mt-1 lg:w-full lg:text-[13px]";

export default function Navigation() {
  const pathname = useLocation().pathname;

  return (
    <>
      <Link
        to="/"
        className="flex items-center gap-3 px-1 text-left lg:px-3 lg:pb-8"
      >
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-[9px] bg-blue-200 text-[17px] font-extrabold text-navy-950"
        >
          W
        </span>
        <span className="text-[17px] font-extrabold tracking-[-.035em] text-white">
          Workspace
        </span>
      </Link>
      <nav className="ml-auto flex items-center gap-1 lg:ml-0 lg:block">
        <p className="hidden px-3 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400 lg:block">
          Workspace
        </p>
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? "page" : undefined}
              className={`${linkClass} ${active ? "bg-navy-800 text-white" : ""}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
