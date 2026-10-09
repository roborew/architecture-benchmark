defmodule PhoenixRestWeb.TasksRoutesTest do
  # The read half of the /api/tasks surface — the workspace list, its count, a
  # single task, and a task's comments. Exercises the full HTTP stack against the
  # seeded test database. Ported from the read describes of the reference
  # variant's tests/integration/tasks.routes.integration.test.ts.
  #
  # async: false — deterministic fixture ids, as in the other routes tests.
  use PhoenixRestWeb.ConnCase, async: false

  alias PhoenixRest.Cursor

  setup :seed_fixture

  # The getTasks contract, in updated_at DESC, id DESC order:
  #   101 (p1,u1,in progress,09-29T08:00), 102 (p1,u2,todo,09-28T11:20),
  #   105 (p2,u1,in progress,09-28T09:30), 103 (p1,u3,done,09-27T16:45),
  #   104 (p2,u2,todo,09-26T10:00), 106 (p3,u3,todo,09-23T11:20)
  #   comments 1, 2 → task 101; 3 → task 104
  defp expected_tasks do
    [
      {101, 1, "Website redesign", "Draft navigation model",
       "Map the navigation structure for the public and authenticated product areas.",
       "in progress", "Robin Andrew", 2, "2026-09-29T08:00:00Z", "2026-09-29T08:00:00.000000Z"},
      {102, 1, "Website redesign", "Confirm breakpoint rules",
       "Agree the breakpoints the shared layout tokens are generated from.", "todo",
       "Alex Morgan", 0, "2026-09-28T11:20:00Z", "2026-09-28T11:20:00.000000Z"},
      {105, 2, "Mobile application", "Build profile screen",
       "Implement the profile screen for existing workspace members.", "in progress",
       "Robin Andrew", 0, "2026-09-28T09:30:00Z", "2026-09-28T09:30:00.000000Z"},
      {103, 1, "Website redesign", "Prepare content inventory",
       "Collect the copy and imagery currently live across the public pages.", "done",
       "Sam Taylor", 0, "2026-09-27T16:45:00Z", "2026-09-27T16:45:00.000000Z"},
      {104, 2, "Mobile application", "Review API response shapes",
       "Check the client expectations against the shapes the service returns.", "todo",
       "Alex Morgan", 1, "2026-09-26T10:00:00Z", "2026-09-26T10:00:00.000000Z"},
      {106, 3, "Platform migration", "Write migration checklist",
       "List the steps and owners for moving to the new platform.", "todo", "Sam Taylor", 0,
       "2026-09-23T11:20:00Z", "2026-09-23T11:20:00.000000Z"}
    ]
    |> Enum.map(fn {id, project_id, project_name, title, description, status, assignee_name,
                    comment_count, updated_at, updated_at_raw} ->
      %{
        "id" => id,
        "projectId" => project_id,
        "projectName" => project_name,
        "title" => title,
        "description" => description,
        "status" => status,
        "assigneeName" => assignee_name,
        "commentCount" => comment_count,
        "updatedAt" => updated_at,
        "updatedAtRaw" => updated_at_raw,
        "cursorFor" => Cursor.encode(updated_at_raw, id)
      }
    end)
  end

  describe "GET /api/tasks" do
    test "returns 200 with a JSON array", %{conn: conn} do
      conn = get(conn, "/api/tasks")

      assert conn.status == 200
      assert get_resp_header(conn, "content-type") |> hd() =~ "json"
      assert is_list(json_response(conn, 200))
    end

    test "returns exactly the seeded tasks, aggregate columns and cursor fields", %{conn: conn} do
      assert get(conn, "/api/tasks") |> json_response(200) == expected_tasks()
    end

    test "returns the whole fixture as the first page (25 is the default limit)", %{conn: conn} do
      assert get(conn, "/api/tasks") |> json_response(200) |> length() == 6
    end

    test "orders tasks by most recently updated, then id descending", %{conn: conn} do
      body = get(conn, "/api/tasks") |> json_response(200)

      assert Enum.map(body, & &1["id"]) == [101, 102, 105, 103, 104, 106]
    end

    test "renders the stored status values without translation", %{conn: conn} do
      statuses = get(conn, "/api/tasks") |> json_response(200) |> Enum.map(& &1["status"])

      assert "in progress" in statuses
      assert "done" in statuses
      assert "todo" in statuses
    end

    test "matches a task title case-insensitively", %{conn: conn} do
      assert [%{"id" => 101, "title" => "Draft navigation model"}] =
               get(conn, "/api/tasks?q=NAVIGATION") |> json_response(200)
    end

    test "matches on description as well as title", %{conn: conn} do
      assert [%{"id" => 104}] = get(conn, "/api/tasks?q=expectations") |> json_response(200)
    end

    test "returns an empty array for a term that matches no task", %{conn: conn} do
      conn = get(conn, "/api/tasks?q=no-such-task")

      assert conn.status == 200
      assert json_response(conn, 200) == []
    end

    test "treats LIKE wildcards in the term as literal characters", %{conn: conn} do
      assert get(conn, "/api/tasks?q=%") |> json_response(200) == []
      assert get(conn, "/api/tasks?q=_") |> json_response(200) == []
    end

    test "ignores surrounding whitespace", %{conn: conn} do
      assert [%{"id" => 101}] =
               get(conn, "/api/tasks?q=%20%20Draft%20navigation%20model%20%20")
               |> json_response(200)
    end

    test "filters by status", %{conn: conn} do
      todo = get(conn, "/api/tasks?status=todo") |> json_response(200)
      done = get(conn, "/api/tasks?status=done") |> json_response(200)

      assert Enum.map(todo, & &1["id"]) == [102, 104, 106]
      assert Enum.map(done, & &1["id"]) == [103]
    end

    test "filters by project and by assignee", %{conn: conn} do
      project = get(conn, "/api/tasks?projectId=1") |> json_response(200)
      assignee = get(conn, "/api/tasks?assigneeId=1") |> json_response(200)

      assert Enum.map(project, & &1["id"]) == [101, 102, 103]
      assert Enum.map(assignee, & &1["id"]) == [101, 105]
    end

    test "combines filters with the search term", %{conn: conn} do
      assert get(conn, "/api/tasks?q=navigation&status=todo") |> json_response(200) == []
    end

    test "returns 400 with the reference's message for an unknown status", %{conn: conn} do
      conn = get(conn, "/api/tasks?status=bogus")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "Unknown task status: bogus"}
    end

    test "returns 400 when q is repeated", %{conn: conn} do
      conn = get(conn, "/api/tasks?q=navigation&q=breakpoint")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "q must be a single value"}
    end

    test "returns 400 when q is longer than 100 characters", %{conn: conn} do
      conn = get(conn, "/api/tasks?q=" <> String.duplicate("a", 101))

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "q must be at most 100 characters"}
    end

    test "returns 400 for a non-integer project or assignee filter", %{conn: conn} do
      project = get(conn, "/api/tasks?projectId=one")
      assignee = get(conn, "/api/tasks?assigneeId=1.5")

      assert project.status == 400
      assert json_response(project, 400) == %{"error" => "projectId must be an integer"}
      assert assignee.status == 400
      assert json_response(assignee, 400) == %{"error" => "assigneeId must be an integer"}
    end

    test "returns 400 for a non-integer limit", %{conn: conn} do
      conn = get(conn, "/api/tasks?limit=many")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "limit must be an integer"}
    end
  end

  describe "GET /api/tasks (keyset paging)" do
    test "limits the page to the requested size", %{conn: conn} do
      body = get(conn, "/api/tasks?limit=3") |> json_response(200)

      assert Enum.map(body, & &1["id"]) == [101, 102, 105]
    end

    test "clamps a zero or negative limit to one row, like the reference", %{conn: conn} do
      assert get(conn, "/api/tasks?limit=0") |> json_response(200) |> length() == 1
      assert get(conn, "/api/tasks?limit=-7") |> json_response(200) |> length() == 1
    end

    test "clamps an oversized limit to 26, the reference's page ceiling", %{conn: conn} do
      # Six seeded rows: the clamp only shows once the fixture outgrows it.
      assert get(conn, "/api/tasks?limit=100") |> json_response(200) |> length() == 6
    end

    test "follows a cursor onto the older page", %{conn: conn} do
      first = get(conn, "/api/tasks?limit=3") |> json_response(200)
      cursor = first |> Enum.at(2) |> Map.fetch!("cursorFor")

      second =
        get(conn, "/api/tasks?limit=3&cursor=" <> URI.encode_www_form(cursor))
        |> json_response(200)

      assert Enum.map(second, & &1["id"]) == [103, 104, 106]
    end

    test "is stable and repeatable: the same cursor yields the same page", %{conn: conn} do
      first = get(conn, "/api/tasks?limit=2") |> json_response(200)
      cursor = first |> Enum.at(1) |> Map.fetch!("cursorFor")
      url = "/api/tasks?limit=2&cursor=" <> URI.encode_www_form(cursor)

      second = get(conn, url) |> json_response(200)
      third = get(conn, url) |> json_response(200)

      assert second == third
      assert Enum.map(second, & &1["id"]) == [105, 103]
    end

    test "reads the first page for a cursor nothing could have produced", %{conn: conn} do
      conn = get(conn, "/api/tasks?cursor=not-a-cursor")

      assert conn.status == 200
      assert conn |> json_response(200) |> Enum.map(& &1["id"]) == [101, 102, 105, 103, 104, 106]
    end

    test "keeps the filters while paging", %{conn: conn} do
      first = get(conn, "/api/tasks?status=todo&limit=2") |> json_response(200)
      cursor = first |> Enum.at(1) |> Map.fetch!("cursorFor")

      second =
        get(conn, "/api/tasks?status=todo&limit=2&cursor=" <> URI.encode_www_form(cursor))
        |> json_response(200)

      assert Enum.map(first, & &1["id"]) == [102, 104]
      assert Enum.map(second, & &1["id"]) == [106]
    end
  end

  describe "GET /api/tasks/count" do
    test "counts every seeded task with no filters", %{conn: conn} do
      conn = get(conn, "/api/tasks/count")

      assert conn.status == 200
      assert json_response(conn, 200) == %{"count" => 6}
    end

    test "counts the tasks matching each filter", %{conn: conn} do
      assert get(conn, "/api/tasks/count?q=navigation") |> json_response(200) == %{"count" => 1}
      assert get(conn, "/api/tasks/count?status=todo") |> json_response(200) == %{"count" => 3}
      assert get(conn, "/api/tasks/count?projectId=1") |> json_response(200) == %{"count" => 3}
      assert get(conn, "/api/tasks/count?assigneeId=1") |> json_response(200) == %{"count" => 2}
    end

    test "shares the list's status rejection", %{conn: conn} do
      conn = get(conn, "/api/tasks/count?status=bogus")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "Unknown task status: bogus"}
    end
  end

  describe "GET /api/tasks/:id" do
    test "returns exactly the task row, without the cursor fields", %{conn: conn} do
      conn = get(conn, "/api/tasks/101")

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "id" => 101,
               "projectId" => 1,
               "projectName" => "Website redesign",
               "title" => "Draft navigation model",
               "description" =>
                 "Map the navigation structure for the public and authenticated product areas.",
               "status" => "in progress",
               "assigneeName" => "Robin Andrew",
               "commentCount" => 2,
               "updatedAt" => "2026-09-29T08:00:00Z"
             }
    end

    test "returns the plain 404 envelope for an unknown id", %{conn: conn} do
      conn = get(conn, "/api/tasks/999")

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "Not found"}
    end

    test "returns 400 for an id that cannot name a row", %{conn: conn} do
      conn = get(conn, "/api/tasks/abc")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "id must be a positive integer"}
    end
  end

  describe "GET /api/tasks/:id/comments" do
    test "returns the task's comments, newest first, with author names", %{conn: conn} do
      conn = get(conn, "/api/tasks/101/comments")

      assert conn.status == 200

      assert json_response(conn, 200) == [
               %{
                 "id" => 2,
                 "taskId" => 101,
                 "authorName" => "Robin Andrew",
                 "body" => "Thanks - I will use that to confirm the signed-in navigation.",
                 "createdAt" => "2026-09-29T10:18:00Z"
               },
               %{
                 "id" => 1,
                 "taskId" => 101,
                 "authorName" => "Alex Morgan",
                 "body" => "I have added the initial content grouping for review.",
                 "createdAt" => "2026-09-29T09:42:00Z"
               }
             ]
    end

    test "returns an empty array for a task with no comments", %{conn: conn} do
      conn = get(conn, "/api/tasks/106/comments")

      assert conn.status == 200
      assert json_response(conn, 200) == []
    end
  end
end
