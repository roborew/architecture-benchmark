import type { TaskStatus } from "@/lib/types";

const tones: Record<TaskStatus, string> = {
	todo: "bg-violet-50 text-violet-700",
	"in progress": "bg-amber-50 text-amber-700",
	done: "bg-emerald-50 text-emerald-700",
};

// The contract's `task-status` text is the raw stored value (`todo`,
// `in progress`, `done`) — spec/contract.md — so the badge renders it verbatim
// and the human-readable capitalisation is CSS only.
export function StatusBadge({ status }: { status: TaskStatus }) {
	return (
		<span
			className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold capitalize ${tones[status]}`}
		>
			{status}
		</span>
	);
}
