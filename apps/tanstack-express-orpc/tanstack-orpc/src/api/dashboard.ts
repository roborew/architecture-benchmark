// src/api/dashboard.ts
//
// How the SPA talks to the server about the dashboard: one aggregate — the
// stats, the recent tasks and the busiest projects — exactly as the home page
// renders them together. Transport details live in `api/api.ts`.

import type { DashboardData } from "@/lib/types";
import { requestJson } from "./api";

/** The dashboard aggregate: stats, recent tasks and the busiest projects. */
export function getDashboard(): Promise<DashboardData> {
	return requestJson<DashboardData>("/api/dashboard");
}
