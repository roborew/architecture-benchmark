defmodule PhoenixRest.TasksWritesTest do
  # The tasks context's write side, ported from the reference variant's model
  # (apps/tanstack-express-rest/express-rest/src/tasks/tasks.model.ts): the ref
  # resolution, the create/update/delete writes, the ONE-transaction
  # create-with-comment, and adding a comment to an existing task.
  #
  # The rollback case is asserted here rather than over HTTP: the endpoint
  # pre-validates everything the schema constrains, so a mid-transaction failure
  # has to be provoked by calling the context directly.
  #
  # async: false — deterministic fixture ids, as in the other context tests.
  use PhoenixRest.DataCase, async: false

  alias PhoenixRest.{Repo, Tasks}

  setup :seed_fixture

  defp filters(overrides) do
    Map.merge(
      %{search: "", status: "", project_id: nil, assignee_id: nil, cursor: nil, limit: nil},
      overrides
    )
  end

  defp create_task(overrides \\ %{}) do
    {:ok, %{id: id}} =
      Tasks.create(
        Map.merge(
          %{
            project_id: 1,
            assignee_id: 2,
            title: "Audit the navigation copy",
            description: "Re-read every navigation label against the new IA.",
            status: "todo"
          },
          overrides
        )
      )

    id
  end

  describe "resolve_refs/2" do
    test "reports nothing when both ids name rows" do
      assert Tasks.resolve_refs(1, 2) == %{}
    end

    test "reports an unknown project under projectId" do
      assert Tasks.resolve_refs(999, 2) == %{"projectId" => ["That project no longer exists."]}
    end

    test "reports an unknown assignee under assigneeId" do
      assert Tasks.resolve_refs(1, 999) == %{"assigneeId" => ["That assignee no longer exists."]}
    end

    test "does not check a null assignee (unassigned is always valid)" do
      assert Tasks.resolve_refs(1, nil) == %{}
    end
  end

  describe "create/1" do
    test "inserts the task and returns its id, with the row committed" do
      id = create_task()

      assert %{"id" => ^id, "projectId" => 1, "status" => "todo", "assigneeName" => "Alex Morgan"} =
               Tasks.get(id)
    end

    test "sets created_at and updated_at equal at insert" do
      id = create_task()

      assert [%{"created_at" => created_at, "updated_at" => updated_at}] =
               Repo.query_maps(
                 "SELECT created_at, updated_at FROM tasks WHERE id = $1",
                 [id]
               )

      assert created_at == updated_at
    end

    test "creates an unassigned task when assignee_id is nil" do
      id = create_task(%{assignee_id: nil})

      assert Tasks.get(id)["assigneeName"] == "Unassigned"
    end
  end

  describe "update/2" do
    test "updates the task and advances updated_at" do
      before = Tasks.get(102)

      assert :ok =
               Tasks.update(102, %{
                 title: "Confirm breakpoint rules (revised)",
                 description: "Agree the breakpoints, including the tablet one.",
                 status: "in progress",
                 assignee_id: 1
               })

      after_update = Tasks.get(102)

      assert after_update["title"] == "Confirm breakpoint rules (revised)"
      assert after_update["description"] == "Agree the breakpoints, including the tablet one."
      assert after_update["status"] == "in progress"
      assert after_update["assigneeName"] == "Robin Andrew"

      # spec/queries.md: the statement must explicitly advance updated_at.
      assert after_update["updatedAt"] != before["updatedAt"]
      assert after_update["updatedAt"] > "2026-09-28T11:20:00Z"
    end

    test "unassigns the task when assignee_id is nil" do
      assert :ok =
               Tasks.update(102, %{
                 title: "Confirm breakpoint rules",
                 description: "Agree the breakpoints.",
                 status: "todo",
                 assignee_id: nil
               })

      assert Tasks.get(102)["assigneeName"] == "Unassigned"
    end

    test "reports a missing assignee before the task" do
      assert {:error, :assignee_missing} =
               Tasks.update(102, %{
                 title: "Confirm breakpoint rules",
                 description: "d",
                 status: "todo",
                 assignee_id: 999
               })
    end

    test "reports a missing task" do
      assert :missing =
               Tasks.update(999, %{
                 title: "No such task",
                 description: "",
                 status: "todo",
                 assignee_id: nil
               })
    end
  end

  describe "remove/1" do
    test "deletes the task and reports the project it belonged to" do
      id = create_task()

      assert {:ok, 1} = Tasks.remove(id)
      assert Tasks.get(id) == nil
    end

    test "cascades the task's comments away with it" do
      id = create_task()

      assert :ok =
               Tasks.add_comment(id, %{
                 body: "A comment that must not outlive its task.",
                 author_id: 1
               })

      assert {:ok, 1} = Tasks.remove(id)

      # A query scoped to a task that no longer exists returns its (empty)
      # comment list, not an error.
      assert Tasks.list_comments(id) == []
    end

    test "reports a missing task" do
      assert :missing = Tasks.remove(999)
    end
  end

  describe "create_with_comment/1" do
    test "creates the task and its first comment in one transaction" do
      assert {:ok, %{id: id}} =
               Tasks.create_with_comment(%{
                 project_id: 1,
                 assignee_id: 1,
                 title: "Publish the navigation copy",
                 description: "Ship the agreed labels.",
                 status: "todo",
                 comment_body: "Copy is finalised and ready to publish.",
                 comment_author_id: 2
               })

      assert %{"id" => ^id, "commentCount" => 1} = Tasks.get(id)

      assert [%{"taskId" => ^id, "authorName" => "Alex Morgan", "body" => body}] =
               Tasks.list_comments(id)

      assert body == "Copy is finalised and ready to publish."
    end

    test "reports an unknown comment author" do
      assert {:error, :author_missing} =
               Tasks.create_with_comment(%{
                 project_id: 1,
                 assignee_id: 1,
                 title: "Publish the navigation copy",
                 description: "Ship the agreed labels.",
                 status: "todo",
                 comment_body: "Copy is finalised.",
                 comment_author_id: 999
               })
    end

    test "rolls back the task when the comment insert fails" do
      # A body over the CHECK on comments.body passes the endpoint's own checks
      # only when the context is called directly; the task insert must not
      # survive it.
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

      # No partial state: the task does not exist.
      assert Tasks.list(filters(%{search: "Must not survive a failed comment"})) == []
    end
  end

  describe "add_comment/2" do
    test "adds a comment to an existing task" do
      assert :ok = Tasks.add_comment(101, %{body: "A new comment.", author_id: 3})

      assert [%{"taskId" => 101, "authorName" => "Sam Taylor", "body" => "A new comment."} | _] =
               Tasks.list_comments(101)
    end

    test "reports a missing task" do
      assert :missing = Tasks.add_comment(999, %{body: "A comment.", author_id: 1})
    end

    test "reports a missing author" do
      assert {:error, :author_missing} =
               Tasks.add_comment(101, %{body: "A comment.", author_id: 999})
    end
  end
end
