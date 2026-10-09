defmodule PhoenixRest.UsersTest do
  # The users context, ported from the reference variant's model
  # (apps/tanstack-express-rest/express-rest/src/users/users.model.ts) — the reads
  # behind the People listing and the member pages, and the writes behind the
  # member forms. Asserted against `spec/snapshots/correctness`, the shared
  # fixture every variant seeds, so a SQL drift is caught here rather than in the
  # browser.
  #
  # The rows are pinned exactly, because the row shape is the API contract the
  # SPA renders; an extra or missing key is a breaking change.
  #
  # async: false — the fixture's explicit ids make every row deterministic, and
  # two sandboxed tests inserting the same ids concurrently would block on each
  # other's uncommitted rows.
  use PhoenixRest.DataCase, async: false

  alias PhoenixRest.{Repo, Users}

  # The shared fixture: users 1–3, projects 1–3, tasks 101–106, comments 1–3.
  setup :seed_fixture

  # The getUsers contract: the DISTINCT aggregate counts, ordered
  # `display_name DESC, id DESC`.
  #
  # Worked through by hand from the fixture:
  #   user 1 (Robin) — tasks 101, 105 (both "in progress"); comment 2  → 2/2/1
  #   user 2 (Alex)  — tasks 102, 104 (both "todo"); comments 1, 3     → 2/2/2
  #   user 3 (Sam)   — tasks 103 ("done"), 106 ("todo"); no comments   → 2/1/0
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

  describe "list/1" do
    test "returns exactly the seeded members and aggregate columns" do
      assert Users.list("") == @expected_users
    end

    test "orders members by display name descending, then id descending" do
      assert Users.list("") |> Enum.map(& &1["id"]) == [3, 1, 2]
    end

    test "counts the join-safe aggregates the listing table renders" do
      # The two LEFT JOINs multiply rows (a member with 2 tasks and 2 comments
      # produces 4 joined rows), so a non-DISTINCT count would double-report.
      assert %{"assignedTaskCount" => 2, "commentCount" => 2} =
               Users.list("") |> Enum.find(&(&1["email"] == "alex@example.test"))

      # "done" tasks count as assigned but not open.
      assert %{"assignedTaskCount" => 2, "openTaskCount" => 1} =
               Users.list("") |> Enum.find(&(&1["email"] == "sam@example.test"))
    end

    test "matches a member name case-insensitively" do
      assert [%{"id" => 1, "name" => "Robin Andrew"}] = Users.list("ROBIN")
    end

    test "matches on email as well as name" do
      assert [%{"id" => 2}] = Users.list("alex@example.test")
    end

    test "returns an empty list for a term that matches no member" do
      assert Users.list("no-such-person") == []
    end

    test "treats LIKE wildcards in the term as literal characters" do
      # A bare `%` would otherwise match every row and hide a real escaping bug.
      assert Users.list("%") == []
      assert Users.list("_") == []
    end
  end

  describe "get/1" do
    test "returns exactly the member row, with the same aggregates as the list" do
      assert Users.get(1) == %{
               "id" => 1,
               "name" => "Robin Andrew",
               "email" => "robin@example.test",
               "assignedTaskCount" => 2,
               "openTaskCount" => 2,
               "commentCount" => 1
             }
    end

    test "returns nil for an unknown id" do
      assert Users.get(999) == nil
    end
  end

  describe "list_tasks/1" do
    test "returns the member's tasks, newest updated first, with project names" do
      assert Users.list_tasks(3) == [
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

    test "scopes by assignee_id, not by display name" do
      assert Users.list_tasks(1) |> Enum.map(& &1["id"]) == [101, 105]
    end

    test "returns an empty list for a member with no tasks" do
      assert Users.list_tasks(999) == []
    end
  end

  describe "create/1" do
    test "inserts the member and returns the new id" do
      assert {:ok, %{id: 4}} =
               Users.create(%{name: "New Person", email: "new@example.test"})

      assert %{"id" => 4, "name" => "New Person", "email" => "new@example.test"} =
               Users.get(4)
    end
  end

  describe "update/2" do
    test "updates the member by primary key" do
      assert :ok =
               Users.update(1, %{
                 name: "Robin Andrew (contractor)",
                 email: "robin@example.test"
               })

      assert %{"id" => 1, "name" => "Robin Andrew (contractor)"} = Users.get(1)
    end

    test "reports a missing member rather than succeeding silently" do
      assert :missing =
               Users.update(999, %{name: "No such", email: "nobody@example.test"})
    end
  end

  describe "remove/1" do
    test "deletes a member with no comments, unassigning their tasks" do
      # Sam (3) has no comments but two tasks; tasks.assignee_id is ON DELETE
      # SET NULL, so the delete succeeds and unassigns rather than blocking.
      assert :ok = Users.remove(3)
      assert Users.get(3) == nil

      assert Repo.query_maps(
               "SELECT id, assignee_id FROM tasks WHERE id IN (103, 106) ORDER BY id"
             ) == [
               %{"id" => 103, "assignee_id" => nil},
               %{"id" => 106, "assignee_id" => nil}
             ]
    end

    test "refuses a member who authored comments, with the reference's guard" do
      # Alex (2) wrote two comments and has two tasks; the comment count is what
      # blocks the delete (RESTRICT), the task count is context (SET NULL).
      assert {:error, {:restricted, message}} = Users.remove(2)

      assert message ==
               "This person still has 2 comments and 2 tasks. Remove the comments before deleting."

      # The refused delete changed nothing.
      assert Users.get(2) != nil
    end

    test "reports a missing member" do
      assert :missing = Users.remove(999)
    end
  end
end
