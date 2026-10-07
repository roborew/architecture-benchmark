// tests/unit/error-handler.test.ts
//
// The Express error handler's mapping contract: a malformed JSON body becomes
// a 400; anything else is logged once and answered with the generic 500. No
// database, no supertest — the response is a fake.
//
// Note how little is left to pin: under REST, controllers threw HttpError and
// this middleware mapped each throw to its envelope. Under oRPC the routers
// throw ORPCError and the handlers serialise it themselves, so the outcomes
// the API decided on never reach Express (the router tests in this directory
// pin those). What remains is Express's own failures only.

import { describe, expect, it, vi } from "vitest";

import { errorHandler } from "../../src/middleware/error-handler.ts";

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function invoke(error: unknown) {
  const res = makeResponse();
  const next = vi.fn();

  errorHandler(error, {} as never, res as never, next as never);

  return res;
}

describe("errorHandler", () => {
  it("answers a malformed JSON body as a 400, not a server fault", () => {
    const parseError = Object.assign(new SyntaxError("Unexpected token"), {
      status: 400,
      type: "entity.parse.failed",
    });

    const res = invoke(parseError);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
  });

  it("logs an unknown error once and answers the generic 500 envelope", () => {
    const error = new Error("db down");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeResponse();

    try {
      errorHandler(error, {} as never, res as never, vi.fn() as never);

      expect(log).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    } finally {
      log.mockRestore();
    }
  });
});
