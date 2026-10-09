defmodule PhoenixRest.TasksTest do
  # The tasks context's read side, ported from the reference variant's model
  # (apps/tanstack-express-rest/express-rest/src/tasks/tasks.model.ts): the
  # workspace list (keyset-paged over `(updated_at, id)`), a single task, a
  # task's comments, and the filtered count. Asserted against
  # `spec/snapshots/correctness`.
  #
  # The row shape is the shared task projection plus the raw `(updated_at, id)`
  # cursor field and the packed `cursorFor`.
  #
  # async: false — deterministic fixture ids, as in the other context tests.
  use PhoenixRest.DataCase, async: false

  alias PhoenixRest.{Cursor, Tasks}

  setup :seed_fixture

  # The getTasks contract, in updated_at DESC, id DESC order.
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

  defp filters(overrides \\ %{}) do
    Map.merge(
      %{search: "", status: "", project_id: nil, assignee_id: nil, cursor: nil, limit: nil},
      overrides
    )
  end

  describe "list/1" do
    test "returns exactly the seeded tasks, aggregate columns and cursor fields" do
      assert Tasks.list(filters()) == expected_tasks()
    end

    test "orders tasks by most recently updated, then id descending" do
      assert Tasks.list(filters()) |> Enum.map(& &1["id"]) == [101, 102, 105, 103, 104, 106]
    end

    test "counts the comments each task carries across the join" do
      by_title = Tasks.list(filters()) |> Map.new(&{&1["title"], &1})

      # Task 101 has two comments and a single assignee; the project and assignee
      # joins must not multiply its comment count.
      assert %{"commentCount" => 2, "assigneeName" => "Robin Andrew"} =
               by_title["Draft navigation model"]

      assert by_title["Review API response shapes"]["commentCount"] == 1
      assert by_title["Write migration checklist"]["commentCount"] == 0
    end

    test "matches a task title case-insensitively" do
      assert [%{"id" => 101, "title" => "Draft navigation model"}] =
               Tasks.list(filters(%{search: "NAVIGATION"}))
    end

    test "matches on description as well as title" do
      # "expectations" appears only in task 104's description, in no title.
      assert [%{"id" => 104}] = Tasks.list(filters(%{search: "expectations"}))
    end

    test "treats LIKE wildcards in the term as literal characters" do
      assert Tasks.list(filters(%{search: "%"})) == []
      assert Tasks.list(filters(%{search: "_"})) == []
    end

    test "filters by status, project and assignee" do
      assert Tasks.list(filters(%{status: "todo"})) |> Enum.map(& &1["id"]) == [102, 104, 106]
      assert Tasks.list(filters(%{status: "done"})) |> Enum.map(& &1["id"]) == [103]
      assert Tasks.list(filters(%{project_id: 1})) |> Enum.map(& &1["id"]) == [101, 102, 103]
      assert Tasks.list(filters(%{assignee_id: 1})) |> Enum.map(& &1["id"]) == [101, 105]
    end

    test "limits the page and clamps the limit to [1, 26]" do
      assert Tasks.list(filters(%{limit: 3})) |> Enum.map(& &1["id"]) == [101, 102, 105]
      assert Tasks.list(filters(%{limit: 0})) |> length() == 1
      assert Tasks.list(filters(%{limit: -7})) |> length() == 1
      # Six seeded rows: the ceiling only shows once the fixture outgrows it.
      assert Tasks.list(filters(%{limit: 100})) |> length() == 6
    end

    test "follows a cursor onto the older page" do
      first = Tasks.list(filters(%{limit: 3}))
      cursor = first |> Enum.at(2) |> Map.fetch!("cursorFor")

      second = Tasks.list(filters(%{limit: 3, cursor: cursor}))

      assert Enum.map(second, & &1["id"]) == [103, 104, 106]
    end

    test "is stable and repeatable: the same cursor yields the same page" do
      first = Tasks.list(filters(%{limit: 2}))
      cursor = first |> Enum.at(1) |> Map.fetch!("cursorFor")

      second = Tasks.list(filters(%{limit: 2, cursor: cursor}))
      third = Tasks.list(filters(%{limit: 2, cursor: cursor}))

      assert second == third
      assert Enum.map(second, & &1["id"]) == [105, 103]
    end

    test "reads the first page for a cursor nothing could have produced" do
      rows = Tasks.list(filters(%{cursor: "not-a-cursor"}))

      assert Enum.map(rows, & &1["id"]) == [101, 102, 105, 103, 104, 106]
    end

    test "keeps the filters while paging" do
      first = Tasks.list(filters(%{status: "todo", limit: 2}))
      cursor = first |> Enum.at(1) |> Map.fetch!("cursorFor")

      second = Tasks.list(filters(%{status: "todo", limit: 2, cursor: cursor}))

      assert Enum.map(first, & &1["id"]) == [102, 104]
      assert Enum.map(second, & &1["id"]) == [106]
    end
  end

  describe "get/1" do
    test "returns exactly the task row, without the cursor fields" do
      assert Tasks.get(101) == %{
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

    test "returns nil for an unknown id" do
      assert Tasks.get(999) == nil
    end
  end

  describe "list_comments/1" do
    test "returns the task's comments, newest first, with author names" do
      assert Tasks.list_comments(101) == [
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

    test "returns an empty list for a task with no comments" do
      assert Tasks.list_comments(106) == []
    end
  end

  describe "count/1" do
    test "counts every seeded task with no filters" do
      assert Tasks.count(filters()) == 6
    end

    test "counts the tasks matching each filter" do
      assert Tasks.count(filters(%{search: "navigation"})) == 1
      assert Tasks.count(filters(%{status: "todo"})) == 3
      assert Tasks.count(filters(%{project_id: 1})) == 3
      assert Tasks.count(filters(%{assignee_id: 1})) == 2
    end
  end
end
