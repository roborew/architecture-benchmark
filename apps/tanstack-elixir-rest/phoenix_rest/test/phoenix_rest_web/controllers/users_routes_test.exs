defmodule PhoenixRestWeb.UsersRoutesTest do
  # The /api/users surface — the reads behind the People listing and member
  # pages, and the writes behind the member forms. Exercises the full HTTP stack
  # (router → controller → context → Postgres) against the seeded test database,
  # and asserts the exact rows the shared fixture produces so a SQL or envelope
  # drift is caught here, not in the browser.
  #
  # Ported from the reference variant's tests/integration/users.routes.
  # integration.test.ts. Bodies are sent as JSON (content-type + Jason), so the
  # endpoint's Plug.Parsers decodes them exactly as a REST client's request, with
  # string keys.
  #
  # async: false — the fixture's explicit ids make every row deterministic, and
  # two sandboxed tests inserting the same ids concurrently would block.
  use PhoenixRestWeb.ConnCase, async: false

  alias PhoenixRest.Repo

  setup :seed_fixture

  # Expected rows, in display_name DESC, id DESC order (the getUsers contract):
  #   users 1 Robin Andrew, 2 Alex Morgan, 3 Sam Taylor
  #   tasks 101, 105 → user 1 (both "in progress"); 102, 104 → user 2 ("todo");
  #         103 → user 3 ("done"), 106 → user 3 ("todo")
  #   comments 1 (author 2), 2 (author 1), 3 (author 2)
  @expected_users [
    %{
      "id" => 3,
      "name" => "Sam Taylor",
      "email" => "sam@example.test",
      "assignedTaskCount" => 2,
      "openTaskCount" => 1,
      "commentCount" => 0
    },
    %{
      "id" => 1,
      "name" => "Robin Andrew",
      "email" => "robin@example.test",
      "assignedTaskCount" => 2,
      "openTaskCount" => 2,
      "commentCount" => 1
    },
    %{
      "id" => 2,
      "name" => "Alex Morgan",
      "email" => "alex@example.test",
      "assignedTaskCount" => 2,
      "openTaskCount" => 2,
      "commentCount" => 2
    }
  ]

  defp post_json(conn, path, body) do
    conn
    |> put_req_header("content-type", "application/json")
    |> post(path, Jason.encode!(body))
  end

  defp patch_json(conn, path, body) do
    conn
    |> put_req_header("content-type", "application/json")
    |> patch(path, Jason.encode!(body))
  end

  describe "GET /api/users" do
    test "returns 200 with a JSON array", %{conn: conn} do
      conn = get(conn, "/api/users")

      assert conn.status == 200
      assert get_resp_header(conn, "content-type") |> hd() =~ "json"
      assert is_list(json_response(conn, 200))
    end

    test "returns exactly the seeded members and aggregate columns", %{conn: conn} do
      # An extra or missing key is a breaking change for the client that renders
      # the row, so the shape is pinned exactly.
      assert get(conn, "/api/users") |> json_response(200) == @expected_users
    end

    test "orders members by display name descending, then id descending", %{conn: conn} do
      body = get(conn, "/api/users") |> json_response(200)

      assert Enum.map(body, & &1["id"]) == [3, 1, 2]
    end

    test "counts the join-safe aggregates the listing table renders", %{conn: conn} do
      by_email =
        get(conn, "/api/users")
        |> json_response(200)
        |> Map.new(&{&1["email"], &1})

      # The two LEFT JOINs multiply rows (a member with 2 tasks and 2 comments
      # produces 4 joined rows), so a non-DISTINCT count would double-report.
      assert %{"assignedTaskCount" => 2, "commentCount" => 2} =
               by_email["alex@example.test"]

      # "done" tasks count as assigned but not open.
      assert %{"assignedTaskCount" => 2, "openTaskCount" => 1} =
               by_email["sam@example.test"]
    end

    test "matches a member name case-insensitively", %{conn: conn} do
      assert [%{"id" => 1, "name" => "Robin Andrew"}] =
               get(conn, "/api/users?q=ROBIN") |> json_response(200)
    end

    test "matches on email as well as name", %{conn: conn} do
      assert [%{"id" => 2}] = get(conn, "/api/users?q=alex@example.test") |> json_response(200)
    end

    test "returns an empty array for a term that matches no member", %{conn: conn} do
      conn = get(conn, "/api/users?q=no-such-person")

      assert conn.status == 200
      assert json_response(conn, 200) == []
    end

    test "treats LIKE wildcards in the term as literal characters", %{conn: conn} do
      # A bare `%` would otherwise match every row and hide a real escaping bug.
      assert get(conn, "/api/users?q=%") |> json_response(200) == []
      assert get(conn, "/api/users?q=_") |> json_response(200) == []
    end

    test "ignores surrounding whitespace", %{conn: conn} do
      assert [%{"id" => 1}] =
               get(conn, "/api/users?q=%20%20Robin%20Andrew%20%20") |> json_response(200)
    end

    test "returns 400 when q is repeated", %{conn: conn} do
      conn = get(conn, "/api/users?q=robin&q=sam")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "q must be a single value"}
    end

    test "returns 400 when q is longer than 100 characters", %{conn: conn} do
      conn = get(conn, "/api/users?q=" <> String.duplicate("a", 101))

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "q must be at most 100 characters"}
    end
  end

  describe "GET /api/users/:id" do
    test "returns exactly the member row, with the same aggregates as the list", %{conn: conn} do
      conn = get(conn, "/api/users/1")

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "id" => 1,
               "name" => "Robin Andrew",
               "email" => "robin@example.test",
               "assignedTaskCount" => 2,
               "openTaskCount" => 2,
               "commentCount" => 1
             }
    end

    test "returns the plain 404 envelope for an unknown id", %{conn: conn} do
      conn = get(conn, "/api/users/999")

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "Not found"}
    end

    test "returns 400 for an id that cannot name a row", %{conn: conn} do
      conn = get(conn, "/api/users/abc")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "id must be a positive integer"}
    end
  end

  describe "GET /api/users/:id/tasks" do
    test "returns the member's tasks, newest updated first, with project names", %{conn: conn} do
      conn = get(conn, "/api/users/3/tasks")

      assert conn.status == 200

      assert json_response(conn, 200) == [
               %{
                 "id" => 103,
                 "projectId" => 1,
                 "projectName" => "Website redesign",
                 "title" => "Prepare content inventory",
                 "description" =>
                   "Collect the copy and imagery currently live across the public pages.",
                 "status" => "done",
                 "assigneeName" => "Sam Taylor",
                 "commentCount" => 0,
                 "updatedAt" => "2026-09-27T16:45:00Z"
               },
               %{
                 "id" => 106,
                 "projectId" => 3,
                 "projectName" => "Platform migration",
                 "title" => "Write migration checklist",
                 "description" => "List the steps and owners for moving to the new platform.",
                 "status" => "todo",
                 "assigneeName" => "Sam Taylor",
                 "commentCount" => 0,
                 "updatedAt" => "2026-09-23T11:20:00Z"
               }
             ]
    end

    test "scopes by assignee_id, not by display name", %{conn: conn} do
      body = get(conn, "/api/users/1/tasks") |> json_response(200)

      assert Enum.map(body, & &1["id"]) == [101, 105]
    end

    test "returns an empty list for a member with no tasks", %{conn: conn} do
      conn = get(conn, "/api/users/999/tasks")

      assert conn.status == 200
      assert json_response(conn, 200) == []
    end
  end

  describe "POST /api/users" do
    test "creates the member and redirects to their page", %{conn: conn} do
      conn = post_json(conn, "/api/users", %{name: "New Person", email: "new@example.test"})

      assert conn.status == 201

      assert json_response(conn, 201) == %{
               "ok" => true,
               "message" => "User created.",
               "redirectTo" => "/users/4"
             }

      detail = get(conn, "/api/users/4")

      assert detail.status == 200

      assert json_response(detail, 200) |> Map.take(["id", "name", "email"]) == %{
               "id" => 4,
               "name" => "New Person",
               "email" => "new@example.test"
             }
    end

    test "reports the reference's field errors for an invalid body", %{conn: conn} do
      conn = post_json(conn, "/api/users", %{name: "Bad Email", email: "not-an-address"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create user.",
               "errors" => %{"email" => ["Enter a valid email address."]}
             }
    end

    test "reports an omitted name exactly as the reference's form does", %{conn: conn} do
      conn = post_json(conn, "/api/users", %{email: "new@example.test"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create user.",
               "errors" => %{"name" => ["Invalid input: expected string, received null"]}
             }
    end
  end

  describe "PATCH /api/users/:id" do
    test "updates the member and redirects to their page", %{conn: conn} do
      conn =
        patch_json(conn, "/api/users/1", %{
          name: "Robin Andrew (contractor)",
          email: "robin@example.test"
        })

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "ok" => true,
               "message" => "User updated.",
               "redirectTo" => "/users/1"
             }

      detail = get(conn, "/api/users/1") |> json_response(200)
      assert %{"id" => 1, "name" => "Robin Andrew (contractor)"} = detail
    end

    test "returns the reference's 404 message for an unknown member", %{conn: conn} do
      conn =
        patch_json(conn, "/api/users/999", %{name: "No such", email: "nobody@example.test"})

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "That user no longer exists."}
    end
  end

  describe "DELETE /api/users/:id" do
    test "deletes a member with no comments, unassigning their tasks", %{conn: conn} do
      # Sam (3) has no comments but two tasks; tasks.assignee_id is ON DELETE
      # SET NULL, so the delete succeeds and unassigns rather than blocking.
      conn = delete(conn, "/api/users/3")

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "ok" => true,
               "message" => "User deleted.",
               "redirectTo" => "/users"
             }

      assert get(conn, "/api/users/3").status == 404

      # The tasks survive, unassigned. The task read surface arrives in a later
      # cycle, so the row is checked directly here.
      assert Repo.query_maps("SELECT assignee_id FROM tasks WHERE id = 103") == [
               %{"assignee_id" => nil}
             ]
    end

    test "refuses a member who authored comments, with the reference's guard", %{conn: conn} do
      # Alex (2) wrote two comments and has two tasks; the comment count is what
      # blocks the delete (RESTRICT), the task count is context (SET NULL).
      conn = delete(conn, "/api/users/2")

      assert conn.status == 409

      assert json_response(conn, 409) == %{
               "error" =>
                 "This person still has 2 comments and 2 tasks. Remove the comments before deleting."
             }

      # The refused delete changed nothing.
      assert get(conn, "/api/users/2").status == 200
    end

    test "returns the reference's 404 message for an unknown member", %{conn: conn} do
      conn = delete(conn, "/api/users/999")

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "That user no longer exists."}
    end
  end
end
