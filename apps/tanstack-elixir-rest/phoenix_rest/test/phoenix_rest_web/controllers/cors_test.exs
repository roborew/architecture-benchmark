defmodule PhoenixRestWeb.CorsTest do
  # The frontend is a separate origin (a Vite dev server / SPA host), so every
  # fetch the TanStack Query layer makes is cross-origin. The browser only
  # exposes the responses if the API answers the CORS contract: reflected
  # origins on simple requests and a successful preflight. Ported from the
  # reference variant's tests/integration/cors.integration.test.ts.
  #
  # async: false — the simple-GET case reads the seeded listing through the real
  # endpoint, so it needs the sandbox and the shared fixture.
  use PhoenixRestWeb.ConnCase, async: false

  setup :seed_fixture

  @frontend_origin "http://localhost:3000"

  test "reflects the request origin on a simple GET", %{conn: conn} do
    conn =
      conn
      |> put_req_header("origin", @frontend_origin)
      |> get("/api/users")

    assert conn.status == 200
    assert get_resp_header(conn, "access-control-allow-origin") == [@frontend_origin]
  end

  test "answers a preflight for GET /api/users", %{conn: conn} do
    conn =
      conn
      |> put_req_header("origin", @frontend_origin)
      |> put_req_header("access-control-request-method", "GET")
      |> options("/api/users")

    assert conn.status < 400
    assert get_resp_header(conn, "access-control-allow-origin") == [@frontend_origin]
    assert get_resp_header(conn, "access-control-allow-methods") |> hd() =~ "GET"
  end

  test "answers a preflight that asks for a JSON content type", %{conn: conn} do
    # The write endpoints send application/json bodies, which always triggers a
    # preflight; the allowance has to be in place.
    conn =
      conn
      |> put_req_header("origin", @frontend_origin)
      |> put_req_header("access-control-request-method", "POST")
      |> put_req_header("access-control-request-headers", "content-type")
      |> options("/api/users")

    assert conn.status < 400
    assert get_resp_header(conn, "access-control-allow-headers") |> hd() =~ "content-type"
  end
end
