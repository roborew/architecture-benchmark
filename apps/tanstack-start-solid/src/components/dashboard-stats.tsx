import type { DashboardStats as Stats } from "@/lib/types";
import { StatCard } from "./stat-card";

export function DashboardStats(props: { stats: Stats }) {
  return (
    <section class="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard
        label="Projects"
        value={props.stats.projectCount}
        hint="Workspace projects"
      />
      <StatCard
        label="Total tasks"
        value={props.stats.totalTasks}
        hint="Across all projects"
      />
      <StatCard
        label="Open tasks"
        value={props.stats.openTasks}
        hint="To do and in progress"
      />
      <StatCard
        label="People"
        value={props.stats.peopleCount}
        hint="Workspace members"
      />
    </section>
  );
}
