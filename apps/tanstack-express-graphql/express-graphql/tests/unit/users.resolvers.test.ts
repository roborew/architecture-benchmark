// tests/unit/users.resolvers.test.ts
//
// The user resolvers' contract with the model stubbed: what they send to the
// model, what they resolve to, and which GraphQLError they throw for each
// refused outcome. No database, no supertest — the model is a fake, and the
// resolvers are called directly, exactly where the old controller tests drove
// the controller with a fake req/res.
//
// Deliberate failures are thrown as GraphQLErrors, and Yoga answers them with
// HTTP 200 and the error inside the response's `errors` array — so the shape
// that used to be asserted against the error handler's JSON envelope (the
// message string, the `code`, the field → messages map) is asserted here
// against the thrown error itself: `message` plus `extensions.code` /
// `extensions.errors` is the whole contract.

import { describe, expect, it, vi } from "vitest";

import { createUsersResolvers } from "../../src/users/users.resolvers.ts";
import type { UsersModel } from "../../src/users/users.model.ts";

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

describe("UsersResolvers.Query.users", () => {
  it("resolves with the model's rows", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([USER]) });

    await expect(
      createUsersResolvers(model).Query.users(null, {}),
    ).resolves.toEqual([USER]);
  });

  it("passes a trimmed q to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createUsersResolvers(model).Query.users(null, { q: "  robin  " });

    expect(list).toHaveBeenCalledWith("robin");
  });

  it("rejects when the model rejects, so Yoga's masked-error path carries it", async () => {
    const model = makeModel({
      list: vi.fn().mockRejectedValue(new Error("db down")),
    });

    // A model failure must propagate out of the resolver as a rejection:
    // Yoga masks it as "Internal server error" at the HTTP edge, but only a
    // resolver that actually rejects gets there.
    await expect(
      createUsersResolvers(model).Query.users(null, {}),
    ).rejects.toThrow("db down");
  });

  it("throws BAD_INPUT for a q that is not a single value", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    // GraphQL types `q` as String, so a client cannot send an array — but the
    // resolver funnels whatever it receives through the shared validator,
    // whose single-value rule (the REST `?q=a&q=b` guard) stays the contract.
    await expect(
      createUsersResolvers(model).Query.users(null, {
        q: ["robin", "sam"] as unknown as string,
      }),
    ).rejects.toMatchObject({
      message: "q must be a single value",
      extensions: { code: "BAD_INPUT" },
    });

    // No query may run for arguments the resolver refused.
    expect(list).not.toHaveBeenCalled();
  });

  it("throws BAD_INPUT when q exceeds 100 characters", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await expect(
      createUsersResolvers(model).Query.users(null, { q: "a".repeat(101) }),
    ).rejects.toMatchObject({
      message: "q must be at most 100 characters",
      extensions: { code: "BAD_INPUT" },
    });

    expect(list).not.toHaveBeenCalled();
  });

  it("passes a 100-character q through as valid", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createUsersResolvers(model).Query.users(null, {
      q: "a".repeat(100),
    });

    expect(list).toHaveBeenCalledWith("a".repeat(100));
  });
});

describe("UsersResolvers.Query.user", () => {
  it("resolves with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(USER) });

    await expect(
      createUsersResolvers(model).Query.user(null, { id: 1 }),
    ).resolves.toEqual(USER);

    expect(model.get).toHaveBeenCalledWith(1);
  });

  it("throws NOT_FOUND when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(
      createUsersResolvers(model).Query.user(null, { id: 999 }),
    ).rejects.toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("UsersResolvers.Query.userTasks", () => {
  it("resolves with the model's rows, scoped by the argument's id", async () => {
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

    await expect(
      createUsersResolvers(model).Query.userTasks(null, { userId: 1 }),
    ).resolves.toEqual([task]);

    expect(model.listTasks).toHaveBeenCalledWith(1);
  });
});

describe("UsersResolvers.Mutation.createUser", () => {
  it("resolves with the success envelope pointing at the new row", async () => {
    const model = makeModel({ create: vi.fn().mockResolvedValue({ id: 4 }) });

    await expect(
      createUsersResolvers(model).Mutation.createUser(null, {
        name: "New Person",
        email: "new@example.test",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "User created.",
      redirectTo: "/users/4",
    });

    expect(model.create).toHaveBeenCalledWith({
      name: "New Person",
      email: "new@example.test",
    });
  });

  it("throws the reference's field-error shape for a bad email", async () => {
    const model = makeModel();

    await expect(
      createUsersResolvers(model).Mutation.createUser(null, {
        name: "New Person",
        email: "nope",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to create user.",
      extensions: {
        code: "BAD_INPUT",
        errors: { email: ["Enter a valid email address."] },
      },
    });

    // Nothing may be written for a body the resolver refused.
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("UsersResolvers.Mutation.updateUser", () => {
  it("resolves with the success envelope pointing at the row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    await expect(
      createUsersResolvers(model).Mutation.updateUser(null, {
        id: 1,
        name: "Renamed",
        email: "renamed@example.test",
      }),
    ).resolves.toEqual({
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
      createUsersResolvers(model).Mutation.updateUser(null, {
        id: 999,
        name: "Renamed",
        email: "renamed@example.test",
      }),
    ).rejects.toMatchObject({
      message: "That user no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("UsersResolvers.Mutation.deleteUser", () => {
  it("resolves with the redirect to the people listing", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    await expect(
      createUsersResolvers(model).Mutation.deleteUser(null, { id: 3 }),
    ).resolves.toEqual({
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
      createUsersResolvers(model).Mutation.deleteUser(null, { id: 999 }),
    ).rejects.toMatchObject({
      message: "That user no longer exists.",
      extensions: { code: "NOT_FOUND" },
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

    // The FK guard's actionable message travels in the GraphQLError's message,
    // with CONFLICT as the code the SPA's api client maps back to 409.
    await expect(
      createUsersResolvers(model).Mutation.deleteUser(null, { id: 2 }),
    ).rejects.toMatchObject({
      message:
        "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      extensions: { code: "CONFLICT" },
    });
  });
});
