import type { TaskStatus } from "@/lib/types";

const tones: Record<TaskStatus, string> = {
	todo: "bg-violet-50 text-violet-700",
	"in progress": "bg-amber-50 text-amber-700",
	done: "bg-emerald-50 text-emerald-700",
};

const labels: Record<TaskStatus, string> = {
	todo: "To do",
	"in progress": "In progress",
	done: "Done",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
	return (
		<span
			className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold ${tones[status]}`}
		>
			{labels[status]}
		</span>
	);
}
