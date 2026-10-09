defmodule PhoenixRestWeb.HealthController do
  # The readiness endpoint. spec/contract.md: `GET /healthz` returns HTTP 200
  # with `{"ok":true}` — it may check DB connectivity, must not perform writes.
  #
  # It deliberately does NOT check connectivity: the e2e webServer starts
  # before its global-setup creates the test database, so a healthz that
  # touched Postgres would never go ready on a clean machine. No Repo call
  # may appear here — the health test runs without the SQL sandbox to keep
  # that structural promise honest.
  @moduledoc false

  use PhoenixRestWeb, :controller

  def show(conn, _params) do
    json(conn, %{ok: true})
  end
end
