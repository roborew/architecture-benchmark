defmodule PhoenixRestWeb.DashboardController do
  # The controller layer for the dashboard: the one read this surface has.
  # Ported from the reference variant's dashboard.controller.ts.
  @moduledoc false

  use PhoenixRestWeb, :controller

  alias PhoenixRest.Dashboard

  @doc "GET /api/dashboard — the stats, recent tasks and busiest projects."
  def show(conn, _params) do
    # The three sections render together, so they are read together. Sequential,
    # not concurrent: the sandbox checks out one connection per test process, so
    # a Task could not share it.
    json(conn, %{
      "stats" => Dashboard.stats(),
      "recentTasks" => Dashboard.recent_tasks(),
      "projects" => Dashboard.projects()
    })
  end
end
