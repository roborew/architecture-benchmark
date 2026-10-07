// tests/unit/users.controller.test.ts
//
// The controller's HTTP contract with the model stubbed: what it sends to the
// model, what it writes to the response, and which HttpError it throws for
// each refused outcome (the error handler maps the throw to the same JSON
// envelope the old direct writes produced). No database, no supertest — the
// model is a fake.

import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { createUsersController } from "../../src/users/users.controller.ts";
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

function makeRequest(
  overrides: {
    query?: Record<string, unknown>;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Request {
  return {
    query: overrides.query ?? {},
    body: overrides.body,
    params: overrides.params ?? {},
  } as unknown as Request;
}

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

type MockResponse = ReturnType<typeof makeResponse>;

function asExpressResponse(res: MockResponse): Response {
  return res as unknown as Response;
}

const USER = {
  id: 1,
  name: "Unit Person",
  email: "unit@example.test",
  assignedTaskCount: 0,
  openTaskCount: 0,
  commentCount: 0,
};

describe("UsersController.list", () => {
  it("responds 200 with the model's rows as JSON", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([USER]) });
    const res = makeResponse();

    await createUsersController(model).list(
      makeRequest(),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([USER]);
  });

  it("passes a trimmed q to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createUsersController(model).list(
      makeRequest({ query: { q: "  robin  " } }),
      asExpressResponse(makeResponse()),
    );

    expect(list).toHaveBeenCalledWith("robin");
  });

  it("rejects when the model rejects, so Express forwards to the error handler", async () => {
    const model = makeModel({
      list: vi.fn().mockRejectedValue(new Error("db down")),
    });

    await expect(
      createUsersController(model).list(
        makeRequest(),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toThrow("db down");
  });

  it("throws the 400 HttpError envelope when q is an array", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });
    const res = makeResponse();

    await expect(
      createUsersController(model).list(
        makeRequest({ query: { q: ["robin", "sam"] } }),
        asExpressResponse(res),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "q must be a single value" },
    });

    // No query may run for a request the API refused.
    expect(list).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("throws 400 when q exceeds 100 characters", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await expect(
      createUsersController(model).list(
        makeRequest({ query: { q: "a".repeat(101) } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "q must be at most 100 characters" },
    });

    expect(list).not.toHaveBeenCalled();
  });

  it("passes a 100-character q through as valid", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createUsersController(model).list(
      makeRequest({ query: { q: "a".repeat(100) } }),
      asExpressResponse(makeResponse()),
    );

    expect(list).toHaveBeenCalledWith("a".repeat(100));
  });
});

describe("UsersController.get", () => {
  it("responds 200 with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(USER) });
    const res = makeResponse();

    await createUsersController(model).get(
      makeRequest({ params: { id: "1" } }),
      asExpressResponse(res),
    );

    expect(model.get).toHaveBeenCalledWith(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(USER);
  });

  it("throws the plain 404 envelope when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(
      createUsersController(model).get(
        makeRequest({ params: { id: "999" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "Not found" },
    });
  });
});

describe("UsersController.listTasks", () => {
  it("responds 200 with the model's rows, scoped by the route id", async () => {
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
    const res = makeResponse();

    await createUsersController(model).listTasks(
      makeRequest({ params: { id: "1" } }),
      asExpressResponse(res),
    );

    expect(model.listTasks).toHaveBeenCalledWith(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([task]);
  });
});

describe("UsersController.create", () => {
  it("responds 201 with the success envelope pointing at the new row", async () => {
    const model = makeModel({ create: vi.fn().mockResolvedValue({ id: 4 }) });
    const res = makeResponse();

    await createUsersController(model).create(
      makeRequest({ body: { name: "New Person", email: "new@example.test" } }),
      asExpressResponse(res),
    );

    expect(model.create).toHaveBeenCalledWith({
      name: "New Person",
      email: "new@example.test",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: "User created.",
      redirectTo: "/users/4",
    });
  });

  it("throws the reference's field-error envelope for a bad email", async () => {
    const model = makeModel();

    await expect(
      createUsersController(model).create(
        makeRequest({ body: { name: "New Person", email: "nope" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to create user.",
        errors: { email: ["Enter a valid email address."] },
      },
    });

    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("UsersController.update", () => {
  it("responds 200 with the success envelope pointing at the row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "ok" }),
    });
    const res = makeResponse();

    await createUsersController(model).update(
      makeRequest({
        params: { id: "1" },
        body: { name: "Renamed", email: "renamed@example.test" },
      }),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
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
      createUsersController(model).update(
        makeRequest({
          params: { id: "999" },
          body: { name: "Renamed", email: "renamed@example.test" },
        }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "That user no longer exists." },
    });
  });
});

describe("UsersController.remove", () => {
  it("responds 200 with the redirect to the people listing", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ status: "ok" }),
    });
    const res = makeResponse();

    await createUsersController(model).remove(
      makeRequest({ params: { id: "3" } }),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
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
      createUsersController(model).remove(
        makeRequest({ params: { id: "999" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "That user no longer exists." },
    });
  });

  it("throws the 409 guard message when the member has comments", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({
        status: "restricted",
        message:
          "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      }),
    });

    await expect(
      createUsersController(model).remove(
        makeRequest({ params: { id: "2" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 409,
      payload: {
        error:
          "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      },
    });
  });
});
