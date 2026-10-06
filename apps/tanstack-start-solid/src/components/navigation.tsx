import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";

import { NAV_ITEMS } from "@/lib/nav";

const linkClass =
  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold text-slate-300 transition hover:bg-navy-800 hover:text-white lg:mt-1 lg:w-full lg:text-[13px]";

const activeClass = "bg-navy-800 text-white";

export default function Navigation() {
  return (
    <>
      <Link
        to="/"
        class="flex items-center gap-3 px-1 text-left lg:px-3 lg:pb-8"
      >
        <span
          aria-hidden="true"
          class="grid h-8 w-8 place-items-center rounded-[9px] bg-blue-200 text-[17px] font-extrabold text-navy-950"
        >
          W
        </span>
        <span class="text-[17px] font-extrabold tracking-[-.035em] text-white">
          Workspace
        </span>
      </Link>
      <nav class="ml-auto flex items-center gap-1 lg:ml-0 lg:block">
        <p class="hidden px-3 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400 lg:block">
          Workspace
        </p>
        <For each={NAV_ITEMS}>
          {(item) => (
            <Link
              to={item.href}
              activeClass={activeClass}
              activeProps={{ "aria-current": "page" }}
              class={linkClass}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )}
        </For>
      </nav>
    </>
  );
}
