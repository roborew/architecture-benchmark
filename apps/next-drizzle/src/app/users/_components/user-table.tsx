import Link from "next/link";
import type { User } from "@/lib/types";
import { initials } from "@/lib/initials";

const th = "px-3 py-3 first:px-5 last:px-5";
const td = "px-3 py-3.5 first:px-5 last:px-5";

export function UserTable({ people }: { people: User[] }) {
  if (people.length === 0) {
    return (
      <p className="px-5 py-6 text-[12px] text-slate-500">
        No people in this workspace.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-165 text-left text-[12px]">
        <thead className="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
          <tr>
            <th className={th}>Person</th>
            <th className={th}>Assigned tasks</th>
            <th className={th}>Open tasks</th>
            <th className={th}>Comments</th>
          </tr>
        </thead>
        <tbody className="text-slate-500">
          {people.map((person) => (
            <tr
              key={person.id}
              className="border-b border-slate-100 transition hover:bg-slate-50"
            >
              <td className={td}>
                <Link
                  href={`/users/${person.id}`}
                  className="flex items-center gap-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-grid h-8 w-8 place-items-center rounded-full bg-indigo-50 align-middle text-[10px] font-extrabold text-indigo-600"
                  >
                    {initials(person.name)}
                  </span>
                  <span>
                    <b className="block text-slate-700">{person.name}</b>
                    <small className="block text-[11px] text-slate-500">
                      {person.email}
                    </small>
                  </span>
                </Link>
              </td>
              <td className={td}>{person.assignedTaskCount}</td>
              <td className={td}>{person.openTaskCount}</td>
              <td className={td}>{person.commentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
