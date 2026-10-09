// tests/unit/users.router.test.ts
//
// The users router's contract with the model stubbed: what it sends to the
// model, what it resolves to, and which ORPCError it throws for each refused
// outcome. No database, no HTTP — the procedure is driven in process through
// `call`, which is the same entry the RPC handler uses, minus the transport.
//
// This replaces the REST variant's users.controller.test.ts: the router is
// the controller now, and the outcomes the controller wrote to the response
// (status codes + JSON envelopes) are carried by the ORPCError codes and the
// error envelope in its `data` (src/orpc/errors.ts owns the mapping).

import { call, ORPCError } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import type { UsersModel } from "../../src/users/users.model.ts";
import { createUsersRouter } from "../../src/orpc/routers/users.ts";

function makeModel(overrides: Partial<UsersModel> = {}): UsersModel {
  return {
    list: vi.fn(),
    get: vi.fn(),
    listTasks: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

const USER = {
  id: 1,
  name: "Unit Person",
  email: "unit@example.test",
  assignedTaskCount: 0,
  openTaskCount: 0,
  commentCount: 0,
};

describe("users.list", () => {
  it("resolves with the model's rows", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([USER]) });

    const rows = await call(createUsersRouter(model).list, { q: "robin" });

    expect(rows).toEqual([USER]);
  });

  it("passes a trimmed q to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await call(createUsersRouter(model).list, { q: "  robin  " });

    expect(list).toHaveBeenCalledWith("robin");
  });

  it("treats an absent q as no filter", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await call(createUsersRouter(model).list, {});

    expect(list).toHaveBeenCalledWith("");
  });

  it("rejects when the model rejects", async () => {
    const model = makeModel({
      list: vi.fn().mockRejectedValue(new Error("db down")),
    });

    await expect(call(createUsersRouter(model).list, {})).rejects.toThrow(
      "db down",
    );
  });

  it("throws the 400 envelope when q exceeds 100 characters", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await expect(
      call(createUsersRouter(model).list, { q: "a".repeat(101) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "q must be at most 100 characters" },
    });

    // No query may run for a call the router refused.
    expect(list).not.toHaveBeenCalled();
  });

  it("passes a 100-character q through as valid", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await call(createUsersRouter(model).list, { q: "a".repeat(100) });

    expect(list).toHaveBeenCalledWith("a".repeat(100));
  });
});

describe("users.byId", () => {
  it("resolves with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(USER) });

    const user = await call(createUsersRouter(model).byId, { id: 1 });

    expect(model.get).toHaveBeenCalledWith(1);
    expect(user).toEqual(USER);
  });

  it("throws the NOT_FOUND envelope when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(call(createUsersRouter(model).byId, { id: 999 })).rejects
      .toMatchObject({
        code: "NOT_FOUND",
        data: { error: "Not found" },
      });
  });
});

describe("users.tasks", () => {
  it("resolves with the model's rows, scoped by the id", async () => {
    const task = {
      id: 101,
      projectId: 1,
      projectName: "Unit Project",
      title: "Unit task",
      description: "",
      status: "todo",
      assigneeName: "Unit Person",
      commentCount: 0,
      updatedAt: "2026-09-29T08:00:00Z",
    };
    const model = makeModel({ listTasks: vi.fn().mockResolvedValue([task]) });

    const tasks = await call(createUsersRouter(model).tasks, { id: 1 });

    expect(model.listTasks).toHaveBeenCalledWith(1);
    expect(tasks).toEqual([task]);
  });
});

describe("users.create", () => {
  it("resolves with the success envelope pointing at the new row", async () => {
    const model = makeModel({ create: vi.fn().mockResolvedValue({ id: 4 }) });

    const result = await call(createUsersRouter(model).create, {
      name: "New Person",
      email: "new@example.test",
    });

    expect(model.create).toHaveBeenCalledWith({
      name: "New Person",
      email: "new@example.test",
    });
    expect(result).toEqual({
      ok: true,
      message: "User created.",
      redirectTo: "/users/4",
    });
  });

  it("throws the reference's field-error envelope for a bad email", async () => {
    const model = makeModel();

    await expect(
      call(createUsersRouter(model).create, {
        name: "New Person",
        email: "nope",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create user.",
        errors: { email: ["Enter a valid email address."] },
      },
    });

    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("users.update", () => {
  it("resolves with the success envelope pointing at the row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    const result = await call(createUsersRouter(model).update, {
      id: 1,
      name: "Renamed",
      email: "renamed@example.test",
    });

    expect(result).toEqual({
      ok: true,
      message: "User updated.",
      redirectTo: "/users/1",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "missing" }),
    });

    await expect(
      call(createUsersRouter(model).update, {
        id: 999,
        name: "Renamed",
        email: "renamed@example.test",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That user no longer exists." },
    });
  });
});

describe("users.remove", () => {
  it("resolves with the redirect to the people listing", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    const result = await call(createUsersRouter(model).remove, { id: 3 });

    expect(result).toEqual({
      ok: true,
      message: "User deleted.",
      redirectTo: "/users",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ status: "missing" }),
    });

    await expect(
      call(createUsersRouter(model).remove, { id: 999 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That user no longer exists." },
    });
  });

  it("throws the CONFLICT guard message when the member has comments", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({
        status: "restricted",
        message:
          "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      }),
    });

    const error = await call(createUsersRouter(model).remove, { id: 2 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      data: {
        error:
          "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      },
    });
  });
});
