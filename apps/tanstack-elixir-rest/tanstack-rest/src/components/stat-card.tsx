// src/components/stat-card.tsx
//
// One metric card on the dashboard's summary strip: a label, the number, and
// the hint that says what was counted. Purely presentational — the value
// arrives as a prop, so the card never disagrees with the aggregate that
// fetched it.

export function StatCard({
	label,
	value,
	hint,
}: {
	label: string;
	value: number;
	hint: string;
}) {
	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
			<span className="block text-[11px] font-semibold text-slate-500">
				{label}
			</span>
			<strong className="mt-3 block text-[25px] font-extrabold tracking-[-.045em] text-slate-800">
				{value}
			</strong>
			<p className="mt-1 text-[11px] text-slate-500">{hint}</p>
		</div>
	);
}
