defmodule PhoenixRestWeb.ProjectsRoutesTest do
  # The /api/projects surface — the reads behind the project listing and board
  # pages, and the writes behind the project forms. Exercises the full HTTP stack
  # (router → controller → context → Postgres) against the seeded test database.
  # Ported from the reference variant's tests/integration/projects.routes.
  # integration.test.ts, including the board's keyset paging over
  # `(created_at, id)`.
  #
  # async: false — deterministic fixture ids, as in the users routes test.
  use PhoenixRestWeb.ConnCase, async: false

  alias PhoenixRest.Cursor

  setup :seed_fixture

  # projects 1 Website redesign (created 09-27), 2 Mobile application (09-21),
  # 3 Platform migration (09-12); tasks 101–103 → p1, 104–105 → p2, 106 → p3.
  @expected_projects [
    %{
      "id" => 1,
      "name" => "Website redesign",
      "description" => "Refresh the public website and onboarding experience.",
      "taskCount" => 3,
      "openTaskCount" => 2,
      "peopleCount" => 3,
      "createdAt" => "2026-09-27"
    },
    %{
      "id" => 2,
      "name" => "Mobile application",
      "description" => "Ship the first mobile experience for existing workspace members.",
      "taskCount" => 2,
      "openTaskCount" => 2,
      "peopleCount" => 2,
      "createdAt" => "2026-09-21"
    },
    %{
      "id" => 3,
      "name" => "Platform migration",
      "description" => "Move the service and supporting processes to the new platform.",
      "taskCount" => 1,
      "openTaskCount" => 1,
      "peopleCount" => 1,
      "createdAt" => "2026-09-12"
    }
  ]

  defp project_1_tasks do
    [
      %{
        "id" => 101,
        "projectId" => 1,
        "projectName" => "Website redesign",
        "title" => "Draft navigation model",
        "description" =>
          "Map the navigation structure for the public and authenticated product areas.",
        "status" => "in progress",
        "assigneeName" => "Robin Andrew",
        "commentCount" => 2,
        "updatedAt" => "2026-09-29T08:00:00Z",
        "createdAtRaw" => "2026-09-28T10:15:00.000000Z"
      },
      %{
        "id" => 102,
        "projectId" => 1,
        "projectName" => "Website redesign",
        "title" => "Confirm breakpoint rules",
        "description" => "Agree the breakpoints the shared layout tokens are generated from.",
        "status" => "todo",
        "assigneeName" => "Alex Morgan",
        "commentCount" => 0,
        "updatedAt" => "2026-09-28T11:20:00Z",
        "createdAtRaw" => "2026-09-27T14:30:00.000000Z"
      },
      %{
        "id" => 103,
        "projectId" => 1,
        "projectName" => "Website redesign",
        "title" => "Prepare content inventory",
        "description" => "Collect the copy and imagery currently live across the public pages.",
        "status" => "done",
        "assigneeName" => "Sam Taylor",
        "commentCount" => 0,
        "updatedAt" => "2026-09-27T16:45:00Z",
        "createdAtRaw" => "2026-09-26T09:05:00.000000Z"
      }
    ]
    |> Enum.map(fn row ->
      Map.put(row, "cursorFor", Cursor.encode(row["createdAtRaw"], row["id"]))
    end)
  end

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

  describe "GET /api/projects" do
    test "returns 200 with a JSON array", %{conn: conn} do
      conn = get(conn, "/api/projects")

      assert conn.status == 200
      assert get_resp_header(conn, "content-type") |> hd() =~ "json"
      assert is_list(json_response(conn, 200))
    end

    test "returns exactly the seeded projects and aggregate columns", %{conn: conn} do
      assert get(conn, "/api/projects") |> json_response(200) == @expected_projects
    end

    test "orders projects by created_at descending, then id descending", %{conn: conn} do
      body = get(conn, "/api/projects") |> json_response(200)

      assert Enum.map(body, & &1["id"]) == [1, 2, 3]
    end

    test "matches a project name case-insensitively", %{conn: conn} do
      assert [%{"id" => 1, "name" => "Website redesign"}] =
               get(conn, "/api/projects?q=REDESIGN") |> json_response(200)
    end

    test "matches on description as well as name", %{conn: conn} do
      platform = get(conn, "/api/projects?q=platform") |> json_response(200)
      onboarding = get(conn, "/api/projects?q=onboarding") |> json_response(200)

      assert Enum.map(platform, & &1["id"]) == [3]
      assert Enum.map(onboarding, & &1["id"]) == [1]
    end

    test "treats LIKE wildcards in the term as literal characters", %{conn: conn} do
      assert get(conn, "/api/projects?q=%") |> json_response(200) == []
      assert get(conn, "/api/projects?q=_") |> json_response(200) == []
    end

    test "returns 400 when q is repeated", %{conn: conn} do
      conn = get(conn, "/api/projects?q=redesign&q=migration")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "q must be a single value"}
    end
  end

  describe "GET /api/projects/:id" do
    test "returns exactly the project row", %{conn: conn} do
      conn = get(conn, "/api/projects/2")

      assert conn.status == 200
      assert json_response(conn, 200) == Enum.at(@expected_projects, 1)
    end

    test "returns the plain 404 envelope for an unknown id", %{conn: conn} do
      conn = get(conn, "/api/projects/999")

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "Not found"}
    end

    test "returns 400 for an id that cannot name a row", %{conn: conn} do
      conn = get(conn, "/api/projects/abc")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "id must be a positive integer"}
    end
  end

  describe "GET /api/projects/:id/tasks" do
    test "returns the board's rows with their cursor fields", %{conn: conn} do
      conn = get(conn, "/api/projects/1/tasks")

      assert conn.status == 200
      assert json_response(conn, 200) == project_1_tasks()
    end

    test "orders the board by created_at descending, then id descending", %{conn: conn} do
      body = get(conn, "/api/projects/1/tasks") |> json_response(200)

      assert Enum.map(body, & &1["id"]) == [101, 102, 103]
    end

    test "returns an empty board for an unknown project", %{conn: conn} do
      conn = get(conn, "/api/projects/999/tasks")

      assert conn.status == 200
      assert json_response(conn, 200) == []
    end

    test "filters the board by status", %{conn: conn} do
      todo = get(conn, "/api/projects/1/tasks?status=todo") |> json_response(200)
      done = get(conn, "/api/projects/1/tasks?status=done") |> json_response(200)

      assert Enum.map(todo, & &1["id"]) == [102]
      assert Enum.map(done, & &1["id"]) == [103]
    end

    test "returns 400 with the reference's message for an unknown status", %{conn: conn} do
      conn = get(conn, "/api/projects/1/tasks?status=shipped")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "Unknown task status: shipped"}
    end

    test "pages the board by keyset over (created_at, id)", %{conn: conn} do
      first = get(conn, "/api/projects/1/tasks?limit=2") |> json_response(200)

      assert Enum.map(first, & &1["id"]) == [101, 102]

      cursor = first |> Enum.at(1) |> Map.fetch!("cursorFor")

      second =
        get(conn, "/api/projects/1/tasks?limit=2&cursor=" <> URI.encode_www_form(cursor))
        |> json_response(200)

      assert Enum.map(second, & &1["id"]) == [103]
    end

    test "is stable and repeatable: the same cursor yields the same page", %{conn: conn} do
      first = get(conn, "/api/projects/1/tasks?limit=1") |> json_response(200)
      cursor = first |> hd() |> Map.fetch!("cursorFor")
      url = "/api/projects/1/tasks?limit=2&cursor=" <> URI.encode_www_form(cursor)

      second = get(conn, url) |> json_response(200)
      third = get(conn, url) |> json_response(200)

      assert second == third
      assert Enum.map(second, & &1["id"]) == [102, 103]
    end

    test "keeps the status filter while paging", %{conn: conn} do
      first = get(conn, "/api/projects/1/tasks?status=todo&limit=1") |> json_response(200)

      assert Enum.map(first, & &1["id"]) == [102]

      cursor = first |> hd() |> Map.fetch!("cursorFor")

      second =
        get(
          conn,
          "/api/projects/1/tasks?status=todo&limit=1&cursor=" <> URI.encode_www_form(cursor)
        )
        |> json_response(200)

      assert second == []
    end

    test "reads the first page for a cursor nothing could have produced", %{conn: conn} do
      conn = get(conn, "/api/projects/1/tasks?cursor=!!!!")

      assert conn.status == 200
      assert conn |> json_response(200) |> Enum.map(& &1["id"]) == [101, 102, 103]
    end

    test "clamps the limit to [1, 26] like the reference", %{conn: conn} do
      zero = get(conn, "/api/projects/1/tasks?limit=0") |> json_response(200)

      assert length(zero) == 1

      huge = get(conn, "/api/projects/1/tasks?limit=99") |> json_response(200)

      # Three tasks in the project: the ceiling only shows once the fixture
      # outgrows it.
      assert length(huge) == 3
    end

    test "returns 400 for a non-integer limit", %{conn: conn} do
      conn = get(conn, "/api/projects/1/tasks?limit=many")

      assert conn.status == 400
      assert json_response(conn, 400) == %{"error" => "limit must be an integer"}
    end
  end

  describe "POST /api/projects" do
    test "creates the project and redirects to its board", %{conn: conn} do
      conn =
        post_json(conn, "/api/projects", %{
          name: "Accessibility audit",
          description: "Audit every surface against WCAG AA."
        })

      assert conn.status == 201

      assert json_response(conn, 201) == %{
               "ok" => true,
               "message" => "Project created.",
               "redirectTo" => "/projects/4"
             }

      detail = get(conn, "/api/projects/4")

      assert detail.status == 200

      assert json_response(detail, 200) == %{
               "id" => 4,
               "name" => "Accessibility audit",
               "description" => "Audit every surface against WCAG AA.",
               "taskCount" => 0,
               "openTaskCount" => 0,
               "peopleCount" => 0,
               "createdAt" => Date.utc_today() |> Date.to_string()
             }
    end

    test "reports the reference's field errors for an empty name", %{conn: conn} do
      conn = post_json(conn, "/api/projects", %{name: "", description: "d"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create project.",
               "errors" => %{"name" => ["Project name is required."]}
             }
    end

    test "requires a description, exactly as the reference's schema does", %{conn: conn} do
      conn = post_json(conn, "/api/projects", %{name: "No description"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create project.",
               "errors" => %{"description" => ["Invalid input: expected string, received null"]}
             }
    end
  end

  describe "PATCH /api/projects/:id" do
    test "updates the project and redirects to it", %{conn: conn} do
      conn =
        patch_json(conn, "/api/projects/2", %{
          name: "Mobile application (v2)",
          description: "Ship the second mobile experience."
        })

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "ok" => true,
               "message" => "Project updated.",
               "redirectTo" => "/projects/2"
             }

      assert %{
               "id" => 2,
               "name" => "Mobile application (v2)",
               "description" => "Ship the second mobile experience.",
               # The aggregates survive an edit of the descriptive fields.
               "taskCount" => 2
             } = get(conn, "/api/projects/2") |> json_response(200)
    end

    test "reports the reference's field errors for a too-long name", %{conn: conn} do
      conn =
        patch_json(conn, "/api/projects/2", %{name: String.duplicate("a", 201), description: "d"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to update project.",
               "errors" => %{"name" => ["Project name must be 200 characters or fewer."]}
             }
    end

    test "returns the reference's 404 message for an unknown project", %{conn: conn} do
      conn = patch_json(conn, "/api/projects/999", %{name: "No such", description: "d"})

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "That project no longer exists."}
    end
  end

  describe "DELETE /api/projects/:id" do
    test "deletes an empty project and redirects to the listing", %{conn: conn} do
      created =
        post_json(conn, "/api/projects", %{name: "Short-lived project", description: "d"})

      id =
        created
        |> json_response(201)
        |> Map.fetch!("redirectTo")
        |> String.split("/")
        |> List.last()

      conn = delete(conn, "/api/projects/#{id}")

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "ok" => true,
               "message" => "Project deleted.",
               "redirectTo" => "/projects"
             }

      detail = get(conn, "/api/projects/#{id}")

      assert detail.status == 404
      assert json_response(detail, 404) == %{"error" => "Not found"}
    end

    test "refuses a project that still has tasks, with the reference's guard", %{conn: conn} do
      singular = delete(conn, "/api/projects/3")

      assert singular.status == 409

      assert json_response(singular, 409) == %{
               "error" => "This project still has 1 task. Delete it before deleting the project."
             }

      plural = delete(conn, "/api/projects/1")

      assert plural.status == 409

      assert json_response(plural, 409) == %{
               "error" =>
                 "This project still has 3 tasks. Delete them before deleting the project."
             }

      # The refused delete changed nothing.
      assert get(conn, "/api/projects/1").status == 200
    end

    test "returns the reference's 404 message for an unknown project", %{conn: conn} do
      conn = delete(conn, "/api/projects/999")

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "That project no longer exists."}
    end
  end
end
