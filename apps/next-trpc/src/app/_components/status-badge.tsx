import type { TaskStatus } from "@/lib/types";

const tones: Record<TaskStatus, string> = {
  todo: "bg-violet-50 text-violet-700",
  "in progress": "bg-amber-50 text-amber-700",
  done: "bg-emerald-50 text-emerald-700",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  // spec/contract.md requires the raw stored value (`todo`, `in progress`,
  // `done`) as the badge text; the capitalised look comes from CSS rather than
  // a JS label map, so the DOM always reads the stored spelling.
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold capitalize ${tones[status]}`}
    >
      {status}
    </span>
  );
}
