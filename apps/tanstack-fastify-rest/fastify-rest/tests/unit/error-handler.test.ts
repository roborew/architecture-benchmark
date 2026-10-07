// tests/unit/error-handler.test.ts
//
// The error handler's mapping contract: a controller's HttpError becomes its
// exact JSON envelope; a malformed JSON body becomes a 400; anything else is
// logged once and answered with the generic 500. No database, no inject — the
// reply is a fake.

import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../src/lib/http-error.ts";
import { errorHandler } from "../../src/middleware/error-handler.ts";

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

function invoke(error: unknown) {
  const reply = makeReply();

  errorHandler(error, {} as never, reply as never);

  return reply;
}

describe("errorHandler", () => {
  it("maps a HttpError to its own status and payload, untouched", () => {
    const reply = invoke(
      HttpError.validation("Missing fields. Failed to create task.", {
        title: ["Title is required."],
      }),
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: "Missing fields. Failed to create task.",
      errors: { title: ["Title is required."] },
    });
  });

  it("maps a 404 HttpError to the plain envelope", () => {
    const reply = invoke(HttpError.notFound("That task no longer exists."));

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: "That task no longer exists.",
    });
  });

  it("maps a 409 HttpError to the reference guard message", () => {
    const reply = invoke(
      HttpError.conflict(
        "This project still has 1 task. Delete it before deleting the project.",
      ),
    );

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith({
      error:
        "This project still has 1 task. Delete it before deleting the project.",
    });
  });

  it("answers a malformed JSON body as a 400, not a server fault", () => {
    // The shape Fastify's built-in body parser throws for a body that is not
    // valid JSON (statusCode 400, code FST_ERR_CTP_INVALID_JSON_BODY) — the
    // counterpart of express.json()'s `entity.parse.failed`.
    const parseError = Object.assign(
      new Error("Body is not valid JSON but content type was set to application/json"),
      { statusCode: 400, code: "FST_ERR_CTP_INVALID_JSON_BODY" },
    );

    const reply = invoke(parseError);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "Invalid JSON body" });
  });

  it("logs an unknown error once and answers the generic 500 envelope", () => {
    const error = new Error("db down");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = makeReply();

    try {
      errorHandler(error, {} as never, reply as never);

      expect(log).toHaveBeenCalledTimes(1);
      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({ error: "Internal server error" });
    } finally {
      log.mockRestore();
    }
  });
});

describe("HttpError", () => {
  it("carries the envelope's error line as its message, for logs and tests", () => {
    expect(new HttpError(404, { error: "Not found" }).message).toBe(
      "Not found",
    );
    expect(new HttpError(503, {}).message).toBe("HTTP 503");
  });
});
