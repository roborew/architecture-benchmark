import { afterAll, describe, expect, it } from "vitest";

import { createComment, type State } from "@/lib/actions";
import { getComments } from "@/lib/data";
import { sql } from "@/lib/db";
import { loadComments, loadUsers } from "../fixtures/load";

// spec/queries.md — task detail shows "the 10 most recent comments with author
// names", ordered `created_at DESC, id DESC`. The bound is the point: an
// unbounded read would load every comment a task ever accumulated.

afterAll(async () => {
  await sql.end();
});

const fixtureComments = loadComments();
const fixtureUsers = loadUsers();

const userName = (id: number) =>
  fixtureUsers.find((u) => u.id === id)?.displayName ?? "";

async function run(action: Promise<State>): Promise<void> {
  try {
    await action;
  } catch {
    // Expected: the action unwound after writing.
  }
}

function form(fields: Record<string, string>) {
  const data = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }

  return data;
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
    await run(
      createComment(
        104,
        {},
        form({ commentBody: "Integration live", commentAuthorId: "1" }),
      ),
    );

    try {
      const comments = await getComments(104);

      expect(comments[0].body).toBe("Integration live");
      expect(comments[0].authorName).toBe(userName(1));
    } finally {
      await sql`DELETE FROM comments WHERE body = 'Integration live'`;
    }
  });
});

describe("createComment", () => {
  it("adds a comment that the read layer returns", async () => {
    const before = await getComments(104);

    await run(
      createComment(
        104,
        {},
        form({ commentBody: "Integration added", commentAuthorId: "3" }),
      ),
    );

    const after = await getComments(104);

    expect(after).toHaveLength(before.length + 1);
    expect(after[0].body).toBe("Integration added");
    expect(after[0].authorName).toBe(userName(3));

    await sql`DELETE FROM comments WHERE body = 'Integration added'`;
  });

  it("sets created_at explicitly, since the column has no default", async () => {
    await run(
      createComment(
        104,
        {},
        form({ commentBody: "Integration timed", commentAuthorId: "1" }),
      ),
    );

    const [row] = await sql<{ id: number }[]>`
      SELECT id::int FROM comments WHERE body = 'Integration timed'
    `;
    const [created] = await sql<{ created_at: Date }[]>`
      SELECT created_at FROM comments WHERE id = ${row.id}
    `;

    expect(created?.created_at).toBeInstanceOf(Date);

    await sql`DELETE FROM comments WHERE body = 'Integration timed'`;
  });

  it("trims the body", async () => {
    await run(
      createComment(
        104,
        {},
        form({ commentBody: "  Integration trimmed  ", commentAuthorId: "1" }),
      ),
    );

    const comments = await getComments(104);

    expect(comments[0].body).toBe("Integration trimmed");

    await sql`DELETE FROM comments WHERE body = 'Integration trimmed'`;
  });

  it("rejects a blank body without inserting", async () => {
    const before = await getComments(104);

    const state = await createComment(
      104,
      {},
      form({ commentBody: "   ", commentAuthorId: "1" }),
    );

    expect(state.errors?.commentBody?.[0]).toBeDefined();
    expect(await getComments(104)).toHaveLength(before.length);
  });

  it("rejects a body over the 1000-character bound the schema enforces", async () => {
    const before = await getComments(104);

    const state = await createComment(
      104,
      {},
      form({ commentBody: "x".repeat(1001), commentAuthorId: "1" }),
    );

    expect(state.errors?.commentBody?.[0]).toContain(
      "1000 characters or fewer",
    );
    expect(await getComments(104)).toHaveLength(before.length);
  });

  it("rejects an author that does not exist", async () => {
    const before = await getComments(104);

    const state = await createComment(
      104,
      {},
      form({ commentBody: "Integration ghost", commentAuthorId: "999999" }),
    );

    expect(state.errors?.commentAuthorId?.[0]).toBeDefined();
    expect(await getComments(104)).toHaveLength(before.length);
  });

  it("reports rather than claims success for a task that no longer exists", async () => {
    const state = await createComment(
      999_999,
      {},
      form({ commentBody: "Integration orphan", commentAuthorId: "1" }),
    );

    expect(state.message).toBe("That task no longer exists.");
  });

  it("counts toward the task's comment count on the list", async () => {
    const { getTask } = await import("@/lib/data");

    // Seeded task 105 has no comments, so its count starts at zero.
    expect((await getTask(105))?.commentCount).toBe(0);

    await run(
      createComment(
        105,
        {},
        form({ commentBody: "Integration counted", commentAuthorId: "1" }),
      ),
    );

    try {
      // The list and the detail run different queries; the count must agree.
      expect((await getTask(105))?.commentCount).toBe(1);
    } finally {
      await sql`DELETE FROM comments WHERE body = 'Integration counted'`;
    }
  });
});
