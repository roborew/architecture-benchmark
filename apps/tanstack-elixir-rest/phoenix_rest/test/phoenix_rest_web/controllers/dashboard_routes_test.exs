defmodule PhoenixRestWeb.DashboardRoutesTest do
  # GET /api/dashboard — the three sections the dashboard page renders: the stat
  # totals in one statement, the three most recently updated tasks, and the two
  # busiest projects (COUNT(t.id) DESC, p.id ASC). Ported from the reference
  # variant's tests/integration/dashboard.routes.integration.test.ts.
  #
  # async: false — deterministic fixture ids, as in the other routes tests.
  use PhoenixRestWeb.ConnCase, async: false

  setup :seed_fixture

  test "returns the stats, recent tasks and busiest projects in one body", %{conn: conn} do
    conn = get(conn, "/api/dashboard")

    assert conn.status == 200
    assert get_resp_header(conn, "content-type") |> hd() =~ "json"

    assert json_response(conn, 200) == %{
             "stats" => %{
               "projectCount" => 3,
               "totalTasks" => 6,
               "openTasks" => 5,
               "peopleCount" => 3,
               "todoTasks" => 3,
               "inProgressTasks" => 2,
               "doneTasks" => 1
             },
             "recentTasks" => [
               %{
                 "id" => 101,
                 "title" => "Draft navigation model",
                 "projectName" => "Website redesign",
                 "status" => "in progress",
                 "assigneeName" => "Robin Andrew",
                 "updatedAt" => "2026-09-29T08:00:00Z"
               },
               %{
                 "id" => 102,
                 "title" => "Confirm breakpoint rules",
                 "projectName" => "Website redesign",
                 "status" => "todo",
                 "assigneeName" => "Alex Morgan",
                 "updatedAt" => "2026-09-28T11:20:00Z"
               },
               %{
                 "id" => 105,
                 "title" => "Build profile screen",
                 "projectName" => "Mobile application",
                 "status" => "in progress",
                 "assigneeName" => "Robin Andrew",
                 "updatedAt" => "2026-09-28T09:30:00Z"
               }
             ],
             "projects" => [
               %{
                 "id" => 1,
                 "name" => "Website redesign",
                 "description" => "Refresh the public website and onboarding experience.",
                 "taskCount" => 3,
                 "openTaskCount" => 2,
                 "peopleCount" => 3
               },
               %{
                 "id" => 2,
                 "name" => "Mobile application",
                 "description" =>
                   "Ship the first mobile experience for existing workspace members.",
                 "taskCount" => 2,
                 "openTaskCount" => 2,
                 "peopleCount" => 2
               }
             ]
           }
  end

  test "orders recent tasks by most recently updated, then id descending", %{conn: conn} do
    body = get(conn, "/api/dashboard") |> json_response(200)

    # "Recent activity" is when the work last moved (updated_at), which is also
    # what PATCH /api/tasks/:id advances.
    assert Enum.map(body["recentTasks"], & &1["id"]) == [101, 102, 105]
  end

  test "orders the projects by task count descending, then id ascending", %{conn: conn} do
    body = get(conn, "/api/dashboard") |> json_response(200)

    assert Enum.map(body["projects"], & &1["id"]) == [1, 2]
  end
end
