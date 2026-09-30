import type { Project, User } from "@/lib/types";
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
      ORDER BY p.created_at DESC, p.id DESC
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch projects.");
  }
}

/**
 * A single project by id, or `null` when no row matches. The edit form needs
 * the stored values to prefill its fields, so this returns the same shape
 * `getProjects` does rather than the raw row.
 */
export async function getProject(id: number): Promise<Project | null> {
  try {
    const [project] = await sql<Project[]>`
      SELECT
        p.id::int AS id,
        p.name,
        p.description,
        COUNT(t.id)::int AS "taskCount",
        COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
        COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
        p.created_at::date::text AS "createdAt"
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      WHERE p.id = ${id}
      GROUP BY p.id, p.name, p.description, p.created_at
    `;

    return project ?? null;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the project.");
  }
}

export async function getUsers(value = "") {
  const term = value.trim();
  const where = term
    ? sql`WHERE u.display_name ILIKE ${`%${escapeLike(term)}%`}
          OR u.email ILIKE ${`%${escapeLike(term)}%`}`
    : sql``;

  try {
    return await sql<User[]>`
      SELECT
        u.id::int AS id,
        u.display_name AS name,
        u.email,
        COUNT(DISTINCT t.id)::int AS "assignedTaskCount",
        COUNT(DISTINCT t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
        COUNT(DISTINCT c.id)::int AS "commentCount"
      FROM users u
      LEFT JOIN tasks t ON u.id = t.assignee_id
      LEFT JOIN comments c ON u.id = c.author_id
      ${where}
      GROUP BY u.id, u.display_name, u.email
      ORDER BY u.display_name DESC, u.id DESC
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch users.");
  }
}
