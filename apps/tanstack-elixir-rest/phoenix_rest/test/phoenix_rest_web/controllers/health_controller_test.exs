defmodule PhoenixRestWeb.HealthControllerTest do
  # The readiness endpoint the rig and every Playwright webServer waits on.
  #
  # Deliberately not ConnCase: spec/contract.md says healthz "may check DB
  # connectivity; must not perform writes", and it must not even read — the
  # e2e server is started before the test database exists, so a healthz that
  # touched Postgres would never go ready on a clean machine. Using
  # Phoenix.ConnTest directly (no SQL sandbox checkout) keeps this test
  # Phoenix.ConnTest directly (no ConnCase — no SQL sandbox checkout):
  # a healthz that queried the Repo would fail without a connection.
  use ExUnit.Case, async: true

  import Phoenix.ConnTest

  @endpoint PhoenixRestWeb.Endpoint

  test "GET /healthz returns 200 with the readiness body" do
    conn = get(build_conn(), "/healthz")

    assert json_response(conn, 200) == %{"ok" => true}
  end
end
