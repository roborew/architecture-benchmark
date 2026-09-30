import type {
  Comment,
  DashboardProject,
  DashboardStats,
  DashboardTask,
  Project,
  Task,
  TaskWithProject,
  User,
} from "@/types";
import { sql } from "./db";

export async function dashBoardStats(): Promise<DashboardStats> {
  const result = await sql`SELECT * FROM dashboard_stats`;
  return result[0] as DashboardStats;
}
