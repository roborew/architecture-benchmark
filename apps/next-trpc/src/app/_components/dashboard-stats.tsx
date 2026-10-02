import type { DashboardStats as Stats } from "@/lib/types";
import { StatCard } from "./stat-card";

export function DashboardStats({ stats }: { stats: Stats }) {
  return (
    <section className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard
        label="Projects"
        value={stats.projectCount}
        hint="Workspace projects"
      />
      <StatCard
        label="Total tasks"
        value={stats.totalTasks}
        hint="Across all projects"
      />
      <StatCard
        label="Open tasks"
        value={stats.openTasks}
        hint="To do and in progress"
      />
      <StatCard
        label="People"
        value={stats.peopleCount}
        hint="Workspace members"
      />
    </section>
  );
}
