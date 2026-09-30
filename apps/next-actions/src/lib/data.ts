import type { Project } from "@/types";
import { sql } from "./db";

const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

export async function getProjects(value = "") {
  const term = value.trim();
  const where = term
    ? sql`WHERE p.name ILIKE ${`%${escapeLike(term)}%`}
          OR p.description ILIKE ${`%${escapeLike(term)}%`}`
    : sql``;

  try {
    return await sql<Project[]>`
      SELECT
        p.id,
        p.name,
        p.description,
        COUNT(t.id)::int AS "taskCount",
        COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
        COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
        p.created_at::date::text AS "createdAt"
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      ${where}
      GROUP BY p.id, p.name, p.description, p.created_at
      ORDER BY p.created_at DESC
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch projects.");
  }
}
