// Placeholder until Stage 2 builds the dashboard section. The heading
// here is load-bearing: navigation e2e asserts it on landing and on
// navigating back, so it cannot be removed before the real page lands.
export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-7 sm:px-8 sm:py-9">
      <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
        Dashboard
      </h1>
    </div>
  );
}
