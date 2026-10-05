import { afterAll, describe, expect, it } from "vitest";

import { getComments } from "@/lib/data";
import { sql } from "@/lib/db";
import { appRouter } from "@/trpc/routers/_app";
import { loadComments, loadUsers } from "../fixtures/load";

// spec/queries.md — task detail shows "the 10 most recent comments with author
// names", ordered `created_at DESC, id DESC`. The bound is the point: an
// unbounded read would load every comment a task ever accumulated.
//
// The write half drives `comments.create` rather than the createComment Server
// Action it replaced. A successful action ended in revalidatePath/redirect, which
// throw outside a Next request context, so each case wrapped it in a `try`/`catch`;
// the procedure returns `{ ok: true, id }` and the throw goes away.

afterAll(async () => {
  await sql.end();
});

const caller = appRouter.createCaller({});

const fixtureComments = loadComments();
const fixtureUsers = loadUsers();

const userName = (id: number) =>
  fixtureUsers.find((u) => u.id === id)?.displayName ?? "";

/** Narrows a refused result so the field errors and message are readable. */
function refusal(result: Awaited<ReturnType<typeof caller.comments.create>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected the procedure to refuse");
  return result;
}

/** Adds a comment and returns the id the procedure reported. */
async function makeComment(
  taskId: number,
  commentBody: string,
  commentAuthorId: number,
) {
  const result = await caller.comments.create({
    taskId,
    commentBody,
    commentAuthorId,
  });

  if (!result.ok) {
    throw new Error(`could not add a comment: ${result.message}`);
  }

  return result.id;
}

describe("getComments", () => {
  it("returns the comments on one task, newest first", async () => {
    const comments = await getComments(101);

    const expected = fixtureComments
      .filter((c) => c.taskId === 101)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

    expect(comments.map((c) => c.id)).toEqual(expected.map((c) => c.id));
    expect(comments.map((c) => c.body)).toEqual(expected.map((c) => c.body));
  });

  it("carries the author name each comment renders with", async () => {
    const comments = await getComments(101);

    for (const comment of comments) {
      const fixture = fixtureComments.find((c) => c.id === comment.id)!;

      expect(comment.authorName).toBe(userName(fixture.authorId));
    }
  });

  it("returns no comments for a task that has none", async () => {
    // Seeded task 103 has no comments.
    expect(await getComments(103)).toEqual([]);
  });

  it("returns no comments for a task that does not exist", async () => {
    expect(await getComments(999_999)).toEqual([]);
  });

  it("never returns more than 10 comments, per spec/queries.md", async () => {
    try {
      await sql.begin(async (tx) => {
        for (let i = 0; i < 15; i++) {
          await tx`
            INSERT INTO comments (task_id, author_id, body, created_at)
            VALUES (
              106, 1, ${`Integration bulk ${i}`},
              ${`2026-10-${String(1 + i).padStart(2, "0")}T09:00:00Z`}
            )
          `;
        }
      });

      const comments = await getComments(106);

      expect(comments).toHaveLength(10);
    } finally {
      await sql`DELETE FROM comments WHERE body LIKE 'Integration bulk %'`;
    }
  });

  it("returns the newest 10 rather than an arbitrary 10", async () => {
    try {
      await sql.begin(async (tx) => {
        for (let i = 0; i < 12; i++) {
          await tx`
            INSERT INTO comments (task_id, author_id, body, created_at)
            VALUES (
              106, 1, ${`Integration newest ${i}`},
              ${`2026-11-${String(1 + i).padStart(2, "0")}T09:00:00Z`}
            )
          `;
        }
      });

      const comments = await getComments(106);

      expect(comments[0].body).toBe("Integration newest 11");
      expect(comments.at(-1)!.body).toBe("Integration newest 2");
    } finally {
      await sql`DELETE FROM comments WHERE body LIKE 'Integration newest %'`;
    }
  });

  it("shows a newly added comment immediately", async () => {
    const id = await makeComment(104, "Integration live", 1);

    try {
      const comments = await getComments(104);

      expect(comments[0].body).toBe("Integration live");
      expect(comments[0].authorName).toBe(userName(1));
    } finally {
      await sql`DELETE FROM comments WHERE id = ${id}`;
    }
  });
});

describe("createComment", () => {
  it("adds a comment that the read layer returns", async () => {
    const before = await getComments(104);

    const id = await makeComment(104, "Integration added", 3);

    const after = await getComments(104);

    expect(after).toHaveLength(before.length + 1);
    expect(after[0].body).toBe("Integration added");
    expect(after[0].authorName).toBe(userName(3));

    await sql`DELETE FROM comments WHERE id = ${id}`;
  });

  it("sets created_at explicitly, since the column has no default", async () => {
    const id = await makeComment(104, "Integration timed", 1);

    const [created] = await sql<{ created_at: Date }[]>`
      SELECT created_at FROM comments WHERE id = ${id}
    `;

    expect(created?.created_at).toBeInstanceOf(Date);

    await sql`DELETE FROM comments WHERE id = ${id}`;
  });

  it("trims the body", async () => {
    const id = await makeComment(104, "  Integration trimmed  ", 1);

    const comments = await getComments(104);

    expect(comments[0].body).toBe("Integration trimmed");

    await sql`DELETE FROM comments WHERE id = ${id}`;
  });

  it("rejects a blank body without inserting", async () => {
    const before = await getComments(104);

    const result = refusal(
      await caller.comments.create({
        taskId: 104,
        commentBody: "   ",
        commentAuthorId: 1,
      }),
    );

    expect(result.errors?.commentBody?.[0]).toBeDefined();
    expect(await getComments(104)).toHaveLength(before.length);
  });

  it("rejects a body over the 1000-character bound the schema enforces", async () => {
    const before = await getComments(104);

    const result = refusal(
      await caller.comments.create({
        taskId: 104,
        commentBody: "x".repeat(1001),
        commentAuthorId: 1,
      }),
    );

    expect(result.errors?.commentBody?.[0]).toContain(
      "1000 characters or fewer",
    );
    expect(await getComments(104)).toHaveLength(before.length);
  });

  it("rejects an author that does not exist", async () => {
    const before = await getComments(104);

    const result = refusal(
      await caller.comments.create({
        taskId: 104,
        commentBody: "Integration ghost",
        commentAuthorId: 999_999,
      }),
    );

    expect(result.errors?.commentAuthorId?.[0]).toBeDefined();
    expect(await getComments(104)).toHaveLength(before.length);
  });

  it("reports rather than claims success for a task that no longer exists", async () => {
    const result = refusal(
      await caller.comments.create({
        taskId: 999_999,
        commentBody: "Integration orphan",
        commentAuthorId: 1,
      }),
    );

    expect(result.message).toBe("That task no longer exists.");
  });

  it("counts toward the task's comment count on the list", async () => {
    const { getTask } = await import("@/lib/data");

    // Seeded task 105 has no comments, so its count starts at zero.
    expect((await getTask(105))?.commentCount).toBe(0);

    const id = await makeComment(105, "Integration counted", 1);

    try {
      // The list and the detail run different queries; the count must agree.
      expect((await getTask(105))?.commentCount).toBe(1);
    } finally {
      await sql`DELETE FROM comments WHERE id = ${id}`;
    }
  });
});
