defmodule PhoenixRestWeb.TasksWritesRoutesTest do
  # The write surface behind the task forms: POST/PATCH/DELETE /api/tasks, the
  # transactional POST /api/tasks/with-comment, and POST /api/tasks/:id/comments.
  # Ported from the reference variant's tests/integration/tasks.writes.
  # integration.test.ts, asserting the exact envelopes (message strings verbatim,
  # field errors keyed by body field) plus the committed state a mutation leaves.
  #
  # async: false — deterministic fixture ids, as in the other routes tests.
  use PhoenixRestWeb.ConnCase, async: false

  alias PhoenixRest.Tasks

  setup :seed_fixture

  @create_body %{
    "projectId" => 1,
    "assigneeId" => 2,
    "title" => "Audit the navigation copy",
    "description" => "Re-read every navigation label against the new IA.",
    "status" => "todo"
  }

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

  # Creates a task over HTTP and returns its id, for the tests that need a row
  # they own.
  defp create_task_id(conn, title) do
    conn
    |> post_json("/api/tasks", %{
      "projectId" => 1,
      "assigneeId" => nil,
      "title" => title,
      "description" => "A task the delete tests own.",
      "status" => "todo"
    })
    |> json_response(201)
    |> Map.fetch!("redirectTo")
    |> String.split("/")
    |> List.last()
  end

  describe "POST /api/tasks" do
    test "creates the task and redirects to its detail page", %{conn: conn} do
      conn = post_json(conn, "/api/tasks", @create_body)

      assert conn.status == 201
      body = json_response(conn, 201)
      assert body["ok"] == true
      assert body["message"] == "Task created."
      assert body["redirectTo"] =~ ~r|^/tasks/\d+$|

      id = body["redirectTo"] |> String.split("/") |> List.last() |> String.to_integer()
      detail = get(conn, "/api/tasks/#{id}")

      assert detail.status == 200

      assert %{
               "projectId" => 1,
               "title" => "Audit the navigation copy",
               "status" => "todo",
               "assigneeName" => "Alex Morgan"
             } =
               json_response(detail, 200)
    end

    test "sets created_at and updated_at equal at insert", %{conn: conn} do
      created =
        post_json(conn, "/api/tasks", Map.put(@create_body, "title", "Timestamp probe"))
        |> json_response(201)

      id = created["redirectTo"] |> String.split("/") |> List.last() |> String.to_integer()

      # created_at is exposed on the board's rows as createdAtRaw; updated_at on
      # every row. They must agree to the second.
      row =
        get(conn, "/api/projects/1/tasks")
        |> json_response(200)
        |> Enum.find(&(&1["id"] == id))

      assert String.slice(row["createdAtRaw"], 0, 19) == String.slice(row["updatedAt"], 0, 19)
    end

    test "creates an unassigned task when assigneeId is null", %{conn: conn} do
      created =
        post_json(conn, "/api/tasks", Map.put(@create_body, "assigneeId", nil))
        |> json_response(201)

      id = created["redirectTo"] |> String.split("/") |> List.last()

      assert get(conn, "/api/tasks/#{id}") |> json_response(200) |> Map.fetch!("assigneeName") ==
               "Unassigned"
    end

    test "reports the reference's field errors for an invalid body", %{conn: conn} do
      conn = post_json(conn, "/api/tasks", %{@create_body | "title" => "", "status" => "bogus"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create task.",
               "errors" => %{
                 "title" => ["Title is required."],
                 "status" => ["Choose a valid status."]
               }
             }
    end

    test "reports an omitted title exactly as the reference's form does", %{conn: conn} do
      conn = post_json(conn, "/api/tasks", %{"projectId" => 1, "status" => "todo"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create task.",
               "errors" => %{"title" => ["Invalid input: expected string, received null"]}
             }
    end

    test "reports the reference's choose-a-project error for a bad project id", %{conn: conn} do
      conn = post_json(conn, "/api/tasks", Map.put(@create_body, "projectId", "one"))

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create task.",
               "errors" => %{"projectId" => ["Choose a project."]}
             }
    end

    test "reports the reference's existence errors for unknown project or assignee", %{conn: conn} do
      project = post_json(conn, "/api/tasks", Map.put(@create_body, "projectId", 999))

      assert project.status == 400

      assert json_response(project, 400) == %{
               "error" => "Missing fields. Failed to create task.",
               "errors" => %{"projectId" => ["That project no longer exists."]}
             }

      assignee = post_json(conn, "/api/tasks", Map.put(@create_body, "assigneeId", 999))

      assert assignee.status == 400

      assert json_response(assignee, 400) == %{
               "error" => "Missing fields. Failed to create task.",
               "errors" => %{"assigneeId" => ["That assignee no longer exists."]}
             }
    end

    test "inserts nothing for a refused body", %{conn: conn} do
      before = get(conn, "/api/tasks/count") |> json_response(200)

      post_json(conn, "/api/tasks", Map.put(@create_body, "projectId", 999))

      after_count = get(conn, "/api/tasks/count") |> json_response(200)

      assert after_count["count"] == before["count"]
    end
  end

  describe "PATCH /api/tasks/:id" do
    test "updates the task, advances updated_at, and redirects to it", %{conn: conn} do
      before = get(conn, "/api/tasks/102") |> json_response(200)

      conn =
        patch_json(conn, "/api/tasks/102", %{
          "title" => "Confirm breakpoint rules (revised)",
          "description" => "Agree the breakpoints, including the tablet one.",
          "status" => "in progress",
          "assigneeId" => 1
        })

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "ok" => true,
               "message" => "Task updated.",
               "redirectTo" => "/tasks/102"
             }

      after_update = get(conn, "/api/tasks/102") |> json_response(200)

      assert %{
               "id" => 102,
               "title" => "Confirm breakpoint rules (revised)",
               "description" => "Agree the breakpoints, including the tablet one.",
               "status" => "in progress",
               "assigneeName" => "Robin Andrew"
             } = after_update

      # spec/queries.md: the statement must explicitly advance updated_at.
      assert after_update["updatedAt"] != before["updatedAt"]
      assert after_update["updatedAt"] > "2026-09-28T11:20:00Z"
    end

    test "unassigns the task when assigneeId is null", %{conn: conn} do
      conn =
        patch_json(conn, "/api/tasks/102", %{
          "title" => "Confirm breakpoint rules",
          "description" => "Agree the breakpoints.",
          "status" => "todo",
          "assigneeId" => nil
        })

      assert conn.status == 200

      assert get(conn, "/api/tasks/102") |> json_response(200) |> Map.fetch!("assigneeName") ==
               "Unassigned"
    end

    test "reports the reference's field errors for an invalid body", %{conn: conn} do
      conn = patch_json(conn, "/api/tasks/102", %{"description" => "d", "status" => "later"})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to update task.",
               "errors" => %{
                 "title" => ["Invalid input: expected string, received null"],
                 "status" => ["Choose a valid status."]
               }
             }
    end

    test "reports the reference's assignee existence error", %{conn: conn} do
      conn =
        patch_json(conn, "/api/tasks/102", %{
          "title" => "Confirm breakpoint rules",
          "description" => "Agree the breakpoints.",
          "status" => "todo",
          "assigneeId" => 999
        })

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to update task.",
               "errors" => %{"assigneeId" => ["That assignee no longer exists."]}
             }
    end

    test "returns the reference's 404 message for an unknown task", %{conn: conn} do
      conn =
        patch_json(conn, "/api/tasks/999", %{
          "title" => "No such task",
          "description" => "",
          "status" => "todo",
          "assigneeId" => nil
        })

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "That task no longer exists."}
    end
  end

  describe "DELETE /api/tasks/:id" do
    test "deletes the task and redirects to its project board", %{conn: conn} do
      id = create_task_id(conn, "Delete me")
      conn = delete(conn, "/api/tasks/#{id}")

      assert conn.status == 200

      assert json_response(conn, 200) == %{
               "ok" => true,
               "message" => "Task deleted.",
               "redirectTo" => "/projects/1"
             }

      detail = get(conn, "/api/tasks/#{id}")

      assert detail.status == 404
      assert json_response(detail, 404) == %{"error" => "Not found"}
    end

    test "cascades the task's comments away with it", %{conn: conn} do
      id = create_task_id(conn, "Delete me with my comments")

      post_json(conn, "/api/tasks/#{id}/comments", %{
        "body" => "A comment that must not outlive its task.",
        "authorId" => 1
      })

      delete(conn, "/api/tasks/#{id}")

      comments = get(conn, "/api/tasks/#{id}/comments")

      # A query scoped to a task that no longer exists returns its (empty)
      # comment list, not an error.
      assert comments.status == 200
      assert json_response(comments, 200) == []
    end

    test "returns the reference's 404 message for an unknown task", %{conn: conn} do
      conn = delete(conn, "/api/tasks/999")

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "That task no longer exists."}
    end
  end

  describe "POST /api/tasks/with-comment" do
    @with_comment %{
      "projectId" => 1,
      "assigneeId" => 1,
      "title" => "Publish the navigation copy",
      "description" => "Ship the agreed labels.",
      "status" => "todo",
      "commentBody" => "Copy is finalised and ready to publish.",
      "commentAuthorId" => 2
    }

    test "creates the task and its first comment in one transaction", %{conn: conn} do
      conn = post_json(conn, "/api/tasks/with-comment", @with_comment)

      assert conn.status == 201
      body = json_response(conn, 201)
      assert body["ok"] == true
      assert body["redirectTo"] =~ ~r|^/tasks/\d+$|

      id = body["redirectTo"] |> String.split("/") |> List.last() |> String.to_integer()

      detail = get(conn, "/api/tasks/#{id}") |> json_response(200)
      comments = get(conn, "/api/tasks/#{id}/comments") |> json_response(200)

      assert %{"id" => ^id, "commentCount" => 1} = detail
      assert length(comments) == 1

      assert %{
               "taskId" => ^id,
               "authorName" => "Alex Morgan",
               "body" => "Copy is finalised and ready to publish."
             } =
               hd(comments)
    end

    test "reports the comment's own field errors with the task's message", %{conn: conn} do
      conn = post_json(conn, "/api/tasks/with-comment", Map.put(@with_comment, "commentBody", ""))

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create the task.",
               "errors" => %{"commentBody" => ["Comment is required."]}
             }
    end

    test "reports the reference's author error, filed where the reference files it", %{conn: conn} do
      conn =
        post_json(conn, "/api/tasks/with-comment", Map.put(@with_comment, "commentAuthorId", 999))

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to create the task.",
               "errors" => %{"assigneeId" => ["That comment author no longer exists."]}
             }
    end

    test "rolls back the task when the comment insert fails", %{conn: conn} do
      # Provoked at the context layer: the endpoint pre-validates everything the
      # schema constrains, so a mid-transaction failure has to bypass it.
      assert_raise Postgrex.Error, fn ->
        Tasks.create_with_comment(%{
          project_id: 1,
          assignee_id: nil,
          title: "Must not survive a failed comment",
          description: "",
          status: "todo",
          comment_body: String.duplicate("x", 1001),
          comment_author_id: 1
        })
      end

      assert get(conn, "/api/tasks?q=Must not survive a failed comment") |> json_response(200) ==
               []
    end
  end

  describe "POST /api/tasks/:id/comments" do
    test "adds the comment and replies ok with no redirect, like the reference", %{conn: conn} do
      conn =
        post_json(conn, "/api/tasks/101/comments", %{
          "body" => "A new comment from the integration suite.",
          "authorId" => 3
        })

      assert conn.status == 201
      assert json_response(conn, 201) == %{"ok" => true}

      comments = get(conn, "/api/tasks/101/comments") |> json_response(200)

      assert length(comments) == 3

      assert %{
               "taskId" => 101,
               "authorName" => "Sam Taylor",
               "body" => "A new comment from the integration suite."
             } =
               hd(comments)
    end

    test "never returns more than the 10 most recent comments", %{conn: conn} do
      created =
        post_json(conn, "/api/tasks", %{
          "projectId" => 2,
          "assigneeId" => nil,
          "title" => "Comment volume probe",
          "description" => "",
          "status" => "todo"
        })
        |> json_response(201)

      id = created["redirectTo"] |> String.split("/") |> List.last()

      # Eleven comments: one more than the bound.
      Enum.each(0..10, fn index ->
        post_json(conn, "/api/tasks/#{id}/comments", %{
          "body" => "Comment number #{index}.",
          "authorId" => 1
        })
      end)

      comments = get(conn, "/api/tasks/#{id}/comments") |> json_response(200)

      assert length(comments) == 10
      assert hd(comments)["body"] == "Comment number 10."
      assert List.last(comments)["body"] == "Comment number 1."
    end

    test "reports the reference's field errors for an empty body", %{conn: conn} do
      conn = post_json(conn, "/api/tasks/101/comments", %{"body" => "", "authorId" => 1})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to add the comment.",
               "errors" => %{"body" => ["Comment is required."]}
             }
    end

    test "reports the reference's author error", %{conn: conn} do
      conn =
        post_json(conn, "/api/tasks/101/comments", %{"body" => "A comment.", "authorId" => 999})

      assert conn.status == 400

      assert json_response(conn, 400) == %{
               "error" => "Missing fields. Failed to add the comment.",
               "errors" => %{"authorId" => ["That comment author no longer exists."]}
             }
    end

    test "returns the reference's 404 message for an unknown task", %{conn: conn} do
      conn =
        post_json(conn, "/api/tasks/999/comments", %{"body" => "A comment.", "authorId" => 1})

      assert conn.status == 404
      assert json_response(conn, 404) == %{"error" => "That task no longer exists."}
    end
  end
end
