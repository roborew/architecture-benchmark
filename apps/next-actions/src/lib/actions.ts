"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { sql } from "./db";

const ProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    // The schema puts no limit on projects.name, but tasks.title caps at 200.
    .max(200, "Project name must be 200 characters or fewer."),
  description: z.string().trim(),
});

export type State = {
  errors?: {
    name?: string[];
    description?: string[];
  };
  message?: string | null;
};

export async function createProject(prevState: State, formData: FormData) {
  const validatedFields = ProjectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create project.",
    };
  }

  const { name, description } = validatedFields.data;

  try {
    // created_at is NOT NULL with no default, so the server sets it.
    await sql`
      INSERT INTO projects (name, description, created_at)
      VALUES (${name}, ${description}, now())
    `;
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create project." };
  }

  revalidatePath("/");
  revalidatePath("/projects");
  redirect("/projects");
}

export async function updateProject(
  id: number,
  prevState: State,
  formData: FormData,
) {
  const validatedFields = ProjectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to update project.",
    };
  }

  const { name, description } = validatedFields.data;

  try {
    // RETURNING distinguishes "no such row" from "row updated", so a stale
    // form cannot report success for a project that is already gone.
    const updated = await sql<{ id: number }[]>`
      UPDATE projects
      SET name = ${name}, description = ${description}
      WHERE id = ${id}
      RETURNING id
    `;

    if (updated.length === 0) {
      return { message: "That project no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to update project." };
  }

  revalidatePath("/");
  revalidatePath("/projects");
  redirect("/projects");
}

export async function deleteProject(
  id: number,
  prevState: State,
  formData: FormData,
) {
  try {
    const deleted = await sql<{ id: number }[]>`
      DELETE FROM projects WHERE id = ${id} RETURNING id
    `;

    if (deleted.length === 0) {
      return { message: "That project no longer exists." };
    }
  } catch (error) {
    // tasks.project_id is ON DELETE RESTRICT, so a project that still has
    // tasks cannot be removed. 23001 is restrict_violation; 23503 is what
    // NO ACTION raises, and both mean the same thing here. This is a rule the
    // user can act on, so it is reported rather than thrown.
    const code = (error as { code?: string }).code;

    if (code === "23001" || code === "23503") {
      const [row] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = ${id}
      `;

      const count = row?.count ?? 0;

      return {
        message:
          count === 1
            ? "This project still has 1 task. Delete it before deleting the project."
            : `This project still has ${count} tasks. Delete them before deleting the project.`,
      };
    }

    console.error("Database Error:", error);
    return { message: "Database Error: Failed to delete project." };
  }

  revalidatePath("/");
  revalidatePath("/projects");
  redirect("/projects");
}
