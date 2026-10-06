export function StatCard(props: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
      <span class="block text-[11px] font-semibold text-slate-500">
        {props.label}
      </span>
      <strong class="mt-3 block text-[25px] font-extrabold tracking-[-.045em] text-slate-800">
        {props.value}
      </strong>
      <p class="mt-1 text-[11px] text-slate-500">{props.hint}</p>
    </div>
  );
}
