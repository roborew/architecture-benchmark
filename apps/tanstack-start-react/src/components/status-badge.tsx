import type { TaskStatus } from "@/lib/types";

const tones: Record<TaskStatus, string> = {
  todo: "bg-violet-50 text-violet-700",
  "in progress": "bg-amber-50 text-amber-700",
  done: "bg-emerald-50 text-emerald-700",
};

/**
 * The task status, as the raw stored value.
 *
 * spec/contract.md requires the element carrying `task-status` to contain the
 * stored value (`todo` | `in progress` | `done`) verbatim — a black-box suite
 * reads it back. The capitalised look comes from CSS, not a JS label map.
 */
export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      data-testid="task-status"
      className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold capitalize ${tones[status]}`}
    >
      {status}
    </span>
  );
}
