// tests/unit/tasks.validator.test.ts
//
// The tasks validator's pure contract: the status filter's value rule, and
// the write bodies. The zod message strings are pinned verbatim against the
// reference variant's actions.ts (TaskSchema / CommentSchema) — a drift here
// is a client-visible change to the API's error contract. No database, no
// transport.
//
// The query-string parsing suites this file used to carry are gone with the
// functions they tested: under oRPC the contract's `.input()` owns the shape
// check (an integer id, a single-value filter), so the validators keep only
// the VALUE rules whose messages the reference owns.

import { describe, expect, it } from "vitest";

import {
  parseCommentBody,
  parseCreateTaskRefs,
  parseTaskFields,
  parseTaskStatus,
  parseUpdateAssignee,
  parseWithCommentFields,
} from "../../src/tasks/tasks.validator.ts";

describe("parseTaskStatus", () => {
  it("accepts each stored status value, and treats absent/empty as no filter", () => {
    expect(parseTaskStatus(undefined)).toEqual({ ok: true, status: "" });
    expect(parseTaskStatus("")).toEqual({ ok: true, status: "" });
    expect(parseTaskStatus(" todo ")).toEqual({ ok: true, status: "todo" });
    expect(parseTaskStatus("in progress")).toEqual({
      ok: true,
      status: "in progress",
    });
    expect(parseTaskStatus("done")).toEqual({ ok: true, status: "done" });
  });

  it("rejects an unknown status with the reference's thrown message", () => {
    expect(parseTaskStatus("bogus")).toEqual({
      ok: false,
      error: "Unknown task status: bogus",
    });
  });

  it("rejects a repeated status param", () => {
    expect(parseTaskStatus(["todo", "done"])).toEqual({
      ok: false,
      error: "status must be a single value",
    });
  });
});

describe("parseTaskFields", () => {
  it("accepts the task fields and trims title and description", () => {
    expect(
      parseTaskFields({
        title: "  Draft navigation model  ",
        description: "  Map the structure  ",
        status: "todo",
      }),
    ).toEqual({
      ok: true,
      data: {
        title: "Draft navigation model",
        description: "Map the structure",
        status: "todo",
      },
    });
  });

  it("treats an omitted description as empty, like an unsubmitted form field", () => {
    expect(parseTaskFields({ title: "T", status: "todo" })).toEqual({
      ok: true,
      data: { title: "T", description: "", status: "todo" },
    });
  });

  it("produces the reference's field messages verbatim", () => {
    const empty = parseTaskFields({ title: "", status: "todo" });
    expect(empty).toEqual({
      ok: false,
      errors: { title: ["Title is required."] },
    });

    const long = parseTaskFields({ title: "a".repeat(201), status: "todo" });
    expect(long).toEqual({
      ok: false,
      errors: { title: ["Title must be 200 characters or fewer."] },
    });

    const status = parseTaskFields({ title: "T", status: "bogus" });
    expect(status).toEqual({
      ok: false,
      errors: { status: ["Choose a valid status."] },
    });
  });

  it("reports an omitted title exactly as the reference's FormData does", () => {
    const missing = parseTaskFields({ status: "todo" });
    expect(missing).toEqual({
      ok: false,
      errors: { title: ["Invalid input: expected string, received null"] },
    });
  });
});

describe("parseCreateTaskRefs", () => {
  it("accepts integer ids and keeps a null assignee nullable", () => {
    expect(parseCreateTaskRefs({ projectId: 1, assigneeId: 2 })).toEqual({
      ok: true,
      projectId: 1,
      assigneeId: 2,
    });
    expect(parseCreateTaskRefs({ projectId: "1", assigneeId: null })).toEqual({
      ok: true,
      projectId: 1,
      assigneeId: null,
    });
    expect(parseCreateTaskRefs({ projectId: 1, assigneeId: "" })).toEqual({
      ok: true,
      projectId: 1,
      assigneeId: null,
    });
  });

  it("produces the reference's choose-a-project / choose-an-assignee errors", () => {
    expect(parseCreateTaskRefs({ assigneeId: 1 })).toEqual({
      ok: false,
      errors: { projectId: ["Choose a project."] },
    });
    expect(parseCreateTaskRefs({ projectId: 1, assigneeId: "x" })).toEqual({
      ok: false,
      errors: { assigneeId: ["Choose a valid assignee."] },
    });
    expect(parseCreateTaskRefs({ projectId: 1.5, assigneeId: 1.5 })).toEqual({
      ok: false,
      errors: {
        projectId: ["Choose a project."],
        assigneeId: ["Choose a valid assignee."],
      },
    });
  });
});

describe("parseUpdateAssignee", () => {
  it("treats absent, null and empty as unassigned", () => {
    expect(parseUpdateAssignee({})).toEqual({ ok: true, assigneeId: null });
    expect(parseUpdateAssignee({ assigneeId: null })).toEqual({
      ok: true,
      assigneeId: null,
    });
    expect(parseUpdateAssignee({ assigneeId: "" })).toEqual({
      ok: true,
      assigneeId: null,
    });
    expect(parseUpdateAssignee({ assigneeId: 3 })).toEqual({
      ok: true,
      assigneeId: 3,
    });
  });

  it("rejects a non-integer assignee", () => {
    expect(parseUpdateAssignee({ assigneeId: "nope" })).toEqual({
      ok: false,
      errors: { assigneeId: ["Choose a valid assignee."] },
    });
  });
});

describe("parseWithCommentFields", () => {
  it("accepts a comment body and author", () => {
    expect(
      parseWithCommentFields({ commentBody: " A note ", commentAuthorId: 2 }),
    ).toEqual({
      ok: true,
      data: { commentBody: "A note", commentAuthorId: 2 },
    });
  });

  it("coerces a string author, as the reference's <select> submits it", () => {
    expect(
      parseWithCommentFields({ commentBody: "A note", commentAuthorId: "2" }),
    ).toEqual({
      ok: true,
      data: { commentBody: "A note", commentAuthorId: 2 },
    });
  });

  it("produces the reference's comment messages verbatim", () => {
    expect(parseWithCommentFields({ commentAuthorId: 2 })).toEqual({
      ok: false,
      errors: { commentBody: ["Comment is required."] },
    });
    expect(
      parseWithCommentFields({
        commentBody: "a".repeat(1001),
        commentAuthorId: 2,
      }),
    ).toEqual({
      ok: false,
      errors: { commentBody: ["Comment must be 1000 characters or fewer."] },
    });
  });

  it("reports an omitted author exactly as the reference's FormData does", () => {
    const missing = parseWithCommentFields({ commentBody: "A note" });
    expect(missing).toEqual({
      ok: false,
      errors: { commentAuthorId: ["Too small: expected number to be >0"] },
    });
  });
});

describe("parseCommentBody", () => {
  it("accepts a body and author keyed by this endpoint's field names", () => {
    expect(parseCommentBody({ body: " A note ", authorId: 1 })).toEqual({
      ok: true,
      data: { body: "A note", authorId: 1 },
    });
  });

  it("carries the same rule strings, keyed by the request's fields", () => {
    expect(parseCommentBody({ authorId: 1 })).toEqual({
      ok: false,
      errors: { body: ["Comment is required."] },
    });
    expect(parseCommentBody({ body: "a".repeat(1001), authorId: 1 })).toEqual({
      ok: false,
      errors: { body: ["Comment must be 1000 characters or fewer."] },
    });
  });
});
