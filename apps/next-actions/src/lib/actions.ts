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

/**
 * `users.email` has no UNIQUE constraint (spec/schema.sql) and
 * spec/contract.md requires none, so no uniqueness rule is imposed here — two
 * members may legitimately share an address. The address is still shape-checked
 * because the form declares `type="email"` and the server should agree.
 */
const UserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "User name is required.")
    .max(200, "User name must be 200 characters or fewer."),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
});

/**
 * The task fields a create or update form submits.
 *
 * `assigneeId` is optional on purpose: the schema's `assignee_id` is nullable
 * and spec/contract.md gives exactly one way to unassign — an explicit empty
 * choice — so an absent or empty value means "unassigned" rather than invalid.
 *
 * `projectId` is coerced to a number so the schema can check the reference, but
 * the raw string is kept for the field-level error: a non-numeric value must be
 * reported against the select the user actually filled in.
 */
const TaskSchema = z.object({
  title: z
    .string()
    .trim()
    // Matches the CHECK (char_length BETWEEN 1 AND 200) in spec/schema.sql, so
    // the same bound is enforced in the form and the database.
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  // `formData.get` returns null for a field the form did not submit at all,
  // which `z.string().default("")` would not catch — `.default` only fills in
  // `undefined`. An omitted description is legal (the column defaults to ''),
  // so null is normalised here rather than reported as a validation failure.
  description: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z.string().trim(),
  ),
  status: z.enum(["todo", "in progress", "done"], {
    message: "Choose a valid status.",
  }),
});

/**
 * A comment submitted on its own, or as the first comment of a new task.
 *
 * The 1000-character bound matches the CHECK on `comments.body` in
 * spec/schema.sql, so the form and the database enforce the same limit. The
 * author is coerced because it arrives from a `<select>` as a string.
 */
const CommentSchema = z.object({
  commentBody: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z
      .string()
      .trim()
      .min(1, "Comment is required.")
      .max(1000, "Comment must be 1000 characters or fewer."),
  ),
  commentAuthorId: z.coerce.number().int().positive(),
});

/** Selects that must resolve to a real row before a task can reference them. */
async function resolveRefs(fields: {
  projectId?: FormDataEntryValue | null;
  assigneeId?: FormDataEntryValue | null;
}) {
  const projectId = Number(fields.projectId);
  const assigneeRaw = fields.assigneeId;
  const assigneeId =
    assigneeRaw === null || assigneeRaw === undefined || assigneeRaw === ""
      ? null
      : Number(assigneeRaw);

  const errors: NonNullable<State["errors"]> = {};

  if (!Number.isInteger(projectId)) {
    errors.projectId = ["Choose a project."];
  } else {
    const [row] = await sql<{ id: number }[]>`
      SELECT id::int FROM projects WHERE id = ${projectId}
    `;

    if (!row) {
      errors.projectId = ["That project no longer exists."];
    }
  }

  if (assigneeId !== null) {
    if (!Number.isInteger(assigneeId)) {
      errors.assigneeId = ["Choose a valid assignee."];
    } else {
      const [row] = await sql<{ id: number }[]>`
        SELECT id::int FROM users WHERE id = ${assigneeId}
      `;

      if (!row) {
        errors.assigneeId = ["That assignee no longer exists."];
      }
    }
  }

  return { projectId, assigneeId, errors };
}

export type State = {
  errors?: {
    name?: string[];
    email?: string[];
    description?: string[];
    title?: string[];
    projectId?: string[];
    assigneeId?: string[];
    status?: string[];
    commentBody?: string[];
    commentAuthorId?: string[];
  };
  message?: string | null;
};

export async function createProject(
  prevState: State,
  formData: FormData,
): Promise<State> {
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
): Promise<State> {
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
): Promise<State> {
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

export async function createUser(
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = UserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create user.",
    };
  }

  const { name, email } = validatedFields.data;

  try {
    await sql`
      INSERT INTO users (display_name, email)
      VALUES (${name}, ${email})
    `;
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create user." };
  }

  revalidatePath("/");
  revalidatePath("/users");
  redirect("/users");
}

export async function updateUser(
  id: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = UserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to update user.",
    };
  }

  const { name, email } = validatedFields.data;

  try {
    // RETURNING distinguishes "no such row" from "row updated", so a stale form
    // cannot report success for a member who is already gone.
    const updated = await sql<{ id: number }[]>`
      UPDATE users
      SET display_name = ${name}, email = ${email}
      WHERE id = ${id}
      RETURNING id
    `;

    if (updated.length === 0) {
      return { message: "That user no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to update user." };
  }

  revalidatePath("/");
  revalidatePath("/users");
  // Back to the detail page rather than the list: the edit control lives there,
  // so the user keeps the context they navigated from.
  redirect(`/users/${id}`);
}

export async function deleteUser(
  id: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  try {
    const deleted = await sql<{ id: number }[]>`
      DELETE FROM users WHERE id = ${id} RETURNING id
    `;

    if (deleted.length === 0) {
      return { message: "That user no longer exists." };
    }
  } catch (error) {
    // Two different FKs behave differently here, and the difference is the
    // whole point of the message:
    //
    //   comments.author_id  ON DELETE RESTRICT — the delete is refused and
    //                                          nothing changes.
    //   tasks.assignee_id   ON DELETE SET NULL — the delete succeeds and the
    //                                          tasks become unassigned.
    //
    // So a failure here is always the comments restriction: 23001 is
    // restrict_violation and 23503 is what NO ACTION raises. This is a rule the
    // user can act on, so it is reported rather than thrown.
    const code = (error as { code?: string }).code;

    if (code === "23001" || code === "23503") {
      const [commentRows, taskRows] = await Promise.all([
        sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM comments WHERE author_id = ${id}
        `,
        sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM tasks WHERE assignee_id = ${id}
        `,
      ]);

      const commentCount = commentRows[0]?.count ?? 0;
      const taskCount = taskRows[0]?.count ?? 0;

      return {
        message:
          `This person still has ${commentCount} ` +
          `${commentCount === 1 ? "comment" : "comments"} and ${taskCount} ` +
          `${taskCount === 1 ? "task" : "tasks"}. Remove ` +
          `${commentCount === 1 ? "the comment" : "the comments"} before deleting.`,
      };
    }

    console.error("Database Error:", error);
    return { message: "Database Error: Failed to delete user." };
  }

  revalidatePath("/");
  revalidatePath("/users");
  redirect("/users");
}

/**
 * spec/queries.md — "Create task": insert one row, with the server setting
 * `created_at` and `updated_at` explicitly and equal. Both columns are NOT NULL
 * with no default, so a statement that omits them fails at the database; setting
 * them here also keeps the two identical, which is what the contract means by
 * "both equal at insert".
 */
export async function createTask(
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = TaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create task.",
    };
  }

  const { projectId, assigneeId, errors } = await resolveRefs({
    projectId: formData.get("projectId"),
    assigneeId: formData.get("assigneeId"),
  });

  if (Object.keys(errors).length > 0) {
    return { errors, message: "Missing fields. Failed to create task." };
  }

  const { title, description, status } = validatedFields.data;

  try {
    await sql`
      INSERT INTO tasks (
        project_id, assignee_id, title, description, status, created_at, updated_at
      )
      VALUES (
        ${projectId}, ${assigneeId}, ${title}, ${description}, ${status}, now(), now()
      )
    `;
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/projects/${projectId}`);
  redirect("/tasks");
}

/**
 * spec/queries.md — "Update task" by primary key, with `updated_at` set in the
 * statement rather than by a DB default or an ORM side effect. An update counts
 * as successful only if the intended row now holds the intended value, which
 * RETURNING confirms.
 */
export async function updateTask(
  id: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = TaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to update task.",
    };
  }

  // The project is deliberately not resolved here. spec/contract.md lists the
  // update form's fields as title, status, assignee and description — a task
  // belongs to its project for its lifetime, and requiring a project field the
  // form does not render would make every edit fail validation.

  const { title, description, status } = validatedFields.data;

  const assigneeRaw = formData.get("assigneeId");
  const assigneeId =
    assigneeRaw === null || assigneeRaw === undefined || assigneeRaw === ""
      ? null
      : Number(assigneeRaw);

  if (assigneeId !== null) {
    const [assignee] = await sql<{ id: number }[]>`
      SELECT id::int FROM users WHERE id = ${assigneeId}
    `;

    if (!assignee) {
      return {
        errors: { assigneeId: ["That assignee no longer exists."] },
        message: "Missing fields. Failed to update task.",
      };
    }
  }

  // Read the project first so the redirect can revalidate the board the task
  // is leaving, or joining.
  const [existing] = await sql<{ project_id: number }[]>`
    SELECT project_id::int FROM tasks WHERE id = ${id}
  `;

  if (!existing) {
    return { message: "That task no longer exists." };
  }

  try {
    const updated = await sql<{ id: number }[]>`
      UPDATE tasks
      SET
        title = ${title},
        description = ${description},
        status = ${status},
        assignee_id = ${assigneeId},
        updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `;

    if (updated.length === 0) {
      return { message: "That task no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to update task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${id}`);
  revalidatePath(`/projects/${existing.project_id}`);

  redirect(`/tasks/${id}`);
}

/**
 * spec/queries.md — "Delete task" under the documented cascade: the task's
 * comments go with it via `comments.task_id` ON DELETE CASCADE.
 */
export async function deleteTask(
  id: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  // Read the project first, both to revalidate its board and because the
  // contract redirects there after a delete.
  const [existing] = await sql<{ project_id: number }[]>`
    SELECT project_id::int FROM tasks WHERE id = ${id}
  `;

  if (!existing) {
    return { message: "That task no longer exists." };
  }

  try {
    const deleted = await sql<{ id: number }[]>`
      DELETE FROM tasks WHERE id = ${id} RETURNING id
    `;

    if (deleted.length === 0) {
      return { message: "That task no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to delete task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/projects/${existing.project_id}`);

  // Straight to the board: the detail page for this id is now not-found, so
  // redirecting there would land the user on a dead URL.
  redirect(`/projects/${existing.project_id}`);
}

/**
 * spec/queries.md — "Create with initial comment": one transaction inserting the
 * task then its comment, with any failure rolling back both.
 *
 * The transaction matters because the task insert alone would otherwise
 * succeed and leave a task whose first comment was never written — a partial
 * state the contract says must never be observable.
 */
export async function createTaskWithComment(
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = TaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status"),
  });

  // The comment has its own bound (char_length BETWEEN 1 AND 1000), enforced by
  // its own schema so the message lands on the comment field.
  const commentFields = CommentSchema.safeParse({
    commentBody: formData.get("commentBody"),
    commentAuthorId: formData.get("commentAuthorId"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create the task.",
    };
  }

  if (!commentFields.success) {
    return {
      errors: commentFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create the task.",
    };
  }

  // Only once the shape of the fields is known to be good does it make sense to
  // ask the database whether the referenced rows exist.
  const { projectId, assigneeId, errors } = await resolveRefs({
    projectId: formData.get("projectId"),
    assigneeId: formData.get("assigneeId"),
  });

  if (Object.keys(errors).length > 0) {
    return { errors, message: "Missing fields. Failed to create the task." };
  }

  const { title, description, status } = validatedFields.data;
  const commentBody = commentFields.data.commentBody.trim();
  const commentAuthorId = commentFields.data.commentAuthorId;

  // The author is a FK like the assignee, so an id that matches no row fails the
  // insert. Checking first turns that into a field error rather than a thrown
  // Postgres error the user cannot act on.
  const [author] = await sql<{ id: number }[]>`
    SELECT id::int FROM users WHERE id = ${commentAuthorId}
  `;

  if (!author) {
    return {
      errors: { assigneeId: ["That comment author no longer exists."] },
      message: "Missing fields. Failed to create the task.",
    };
  }

  try {
    await sql.begin(async (tx) => {
      const [row] = await tx<{ id: number }[]>`
        INSERT INTO tasks (
          project_id, assignee_id, title, description, status, created_at, updated_at
        )
        VALUES (
          ${projectId}, ${assigneeId}, ${title}, ${description}, ${status}, now(), now()
        )
        RETURNING id::int AS id
      `;

      // Inside the same transaction, so a failure here throws and the task
      // insert above is rolled back with it.
      await tx`
        INSERT INTO comments (task_id, author_id, body, created_at)
        VALUES (${row.id}, ${commentAuthorId}, ${commentBody}, now())
      `;
    });
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create the task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/projects/${projectId}`);
  redirect("/tasks");
}

/**
 * Adds a comment to an existing task.
 *
 * Separate from `createTaskWithComment` because a comment on an existing task
 * is a single insert — the atomicity that form needs comes from being one
 * transaction with the task insert, which this path has no part in.
 */
export async function createComment(
  taskId: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  const parsed = CommentSchema.safeParse({
    commentBody: formData.get("commentBody"),
    commentAuthorId: formData.get("commentAuthorId"),
  });

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      message: "Missing fields. Failed to add the comment.",
    };
  }

  const commentBody = parsed.data.commentBody;
  const commentAuthorId = parsed.data.commentAuthorId;

  // The task and the author are both foreign keys. Checking first turns an
  // unknown id into a field error the user can act on, rather than a thrown
  // Postgres error.
  const [[task], [author]] = await Promise.all([
    sql<{ id: number }[]>`SELECT id::int FROM tasks WHERE id = ${taskId}`,
    sql<
      { id: number }[]
    >`SELECT id::int FROM users WHERE id = ${commentAuthorId}`,
  ]);

  if (!task) {
    return { message: "That task no longer exists." };
  }

  if (!author) {
    return {
      errors: { commentAuthorId: ["That comment author no longer exists."] },
      message: "Missing fields. Failed to add the comment.",
    };
  }

  try {
    await sql`
      INSERT INTO comments (task_id, author_id, body, created_at)
      VALUES (${taskId}, ${commentAuthorId}, ${commentBody}, now())
    `;
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to add the comment." };
  }

  // The count on the task list changed, so both the detail page and the list
  // are now stale.
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");

  const [row] = await sql<{ project_id: number }[]>`
    SELECT project_id::int FROM tasks WHERE id = ${taskId}
  `;

  if (row) {
    revalidatePath(`/projects/${row.project_id}`);
  }

  // No redirect: the user stays on the task detail page and sees the comment
  // they just wrote in the list above the form.
  return {};
}
