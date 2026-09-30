import type { Project } from "@/lib/types";
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
        -- bigint comes back from postgres.js as a string unless cast, which
        -- would silently violate the Project['id']: number contract. Every
        -- other numeric column is cast for the same reason.
        p.id::int AS id,
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
      -- created_at is the documented order. The fixture spaces project
      -- timestamps apart, but id is added as a tiebreaker so equal timestamps
      -- cannot make the result order non-deterministic.
      ORDER BY p.created_at DESC, p.id DESC
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch projects.");
  }
}
