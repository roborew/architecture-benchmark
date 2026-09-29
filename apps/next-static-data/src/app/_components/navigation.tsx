import { NAV_ITEMS } from "@/lib/nav";
import Link from "next/link";

export default function Navigation() {
  const nav = NAV_ITEMS;
  return (
    <nav className="ml-auto flex items-center gap-1 lg:ml-0 lg:block">
      {nav.map((item) => (
        <Link href={item.href} key={item.href}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
