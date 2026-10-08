defmodule PhoenixRest.ProjectsTest do
  # The projects context, ported from the reference variant's model
  # (apps/tanstack-express-rest/express-rest/src/projects/projects.model.ts) —
  # the reads behind the project listing and board pages, and the writes behind
  # the project forms. Asserted against `spec/snapshots/correctness`.
  #
  # The project board's keyset paging over `(created_at, id)` is covered here
  # too: the board is this surface's read, and its rows share the task
  # projection.
  #
  # async: false — deterministic fixture ids, as in the users context test.
  use PhoenixRest.DataCase, async: false

  alias PhoenixRest.{Cursor, Projects}

  setup :seed_fixture

  # The getProjects contract, in created_at DESC, id DESC order.
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

  # Project 1's board, in created_at DESC, id DESC order.
  defp board_rows do
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

  defp board_filters(overrides \\ %{}) do
    Map.merge(%{status: "", cursor: nil, limit: nil}, overrides)
  end

  describe "list/1" do
    test "returns exactly the seeded projects and aggregate columns" do
      assert Projects.list("") == @expected_projects
    end

    test "orders projects by created_at descending, then id descending" do
      assert Projects.list("") |> Enum.map(& &1["id"]) == [1, 2, 3]
    end

    test "matches a project name case-insensitively" do
      assert [%{"id" => 1, "name" => "Website redesign"}] = Projects.list("REDESIGN")
    end

    test "matches on description as well as name" do
      # "platform" appears in project 3's description and its name; "onboarding"
      # only in project 1's description.
      assert Projects.list("platform") |> Enum.map(& &1["id"]) == [3]
      assert Projects.list("onboarding") |> Enum.map(& &1["id"]) == [1]
    end

    test "treats LIKE wildcards in the term as literal characters" do
      assert Projects.list("%") == []
      assert Projects.list("_") == []
    end
  end

  describe "get/1" do
    test "returns exactly the project row" do
      assert Projects.get(2) == Enum.at(@expected_projects, 1)
    end

    test "returns nil for an unknown id" do
      assert Projects.get(999) == nil
    end
  end

  describe "list_tasks/2" do
    test "returns the board's rows with their cursor fields" do
      assert Projects.list_tasks(1, board_filters()) == board_rows()
    end

    test "orders the board by created_at descending, then id descending" do
      assert Projects.list_tasks(1, board_filters()) |> Enum.map(& &1["id"]) == [101, 102, 103]
    end

    test "returns an empty board for an unknown project" do
      assert Projects.list_tasks(999, board_filters()) == []
    end

    test "filters the board by status" do
      assert Projects.list_tasks(1, board_filters(%{status: "todo"})) |> Enum.map(& &1["id"]) ==
               [102]

      assert Projects.list_tasks(1, board_filters(%{status: "done"})) |> Enum.map(& &1["id"]) ==
               [103]
    end

    test "pages the board by keyset over (created_at, id)" do
      first = Projects.list_tasks(1, board_filters(%{limit: 2}))

      assert Enum.map(first, & &1["id"]) == [101, 102]

      # The last row's cursorFor is the (created_at, id) tuple the next page
      # starts after.
      cursor = first |> Enum.at(1) |> Map.fetch!("cursorFor")
      second = Projects.list_tasks(1, board_filters(%{limit: 2, cursor: cursor}))

      assert Enum.map(second, & &1["id"]) == [103]
    end

    test "is stable and repeatable: the same cursor yields the same page" do
      first = Projects.list_tasks(1, board_filters(%{limit: 1}))
      cursor = first |> hd() |> Map.fetch!("cursorFor")

      second = Projects.list_tasks(1, board_filters(%{limit: 2, cursor: cursor}))
      third = Projects.list_tasks(1, board_filters(%{limit: 2, cursor: cursor}))

      assert second == third
      assert Enum.map(second, & &1["id"]) == [102, 103]
    end

    test "keeps the status filter while paging" do
      first = Projects.list_tasks(1, board_filters(%{status: "todo", limit: 1}))

      assert Enum.map(first, & &1["id"]) == [102]

      # The cursor must not silently reset the filter: the next page is the
      # NEXT TODO TASK, not the next task.
      cursor = first |> hd() |> Map.fetch!("cursorFor")
      second = Projects.list_tasks(1, board_filters(%{status: "todo", limit: 1, cursor: cursor}))

      assert second == []
    end

    test "reads the first page for a cursor nothing could have produced" do
      rows = Projects.list_tasks(1, board_filters(%{cursor: "!!!!"}))

      assert Enum.map(rows, & &1["id"]) == [101, 102, 103]
    end

    test "clamps the limit to [1, 26] like the reference" do
      assert Projects.list_tasks(1, board_filters(%{limit: 0})) |> length() == 1
      # Three tasks in the project: the ceiling only shows once the fixture
      # outgrows it.
      assert Projects.list_tasks(1, board_filters(%{limit: 99})) |> length() == 3
    end
  end

  describe "create/1" do
    test "inserts the project, server-set created_at, and returns the new id" do
      assert {:ok, %{id: 4}} =
               Projects.create(%{
                 name: "Accessibility audit",
                 description: "Audit every surface against WCAG AA."
               })

      assert %{
               "id" => 4,
               "name" => "Accessibility audit",
               "description" => "Audit every surface against WCAG AA.",
               "taskCount" => 0,
               "openTaskCount" => 0,
               "peopleCount" => 0,
               "createdAt" => created_at
             } = Projects.get(4)

      assert created_at == Date.utc_today() |> Date.to_string()
    end
  end

  describe "update/2" do
    test "updates the project by primary key, keeping its aggregates" do
      assert :ok =
               Projects.update(2, %{
                 name: "Mobile application (v2)",
                 description: "Ship the second mobile experience."
               })

      assert %{
               "id" => 2,
               "name" => "Mobile application (v2)",
               "description" => "Ship the second mobile experience.",
               "taskCount" => 2
             } = Projects.get(2)
    end

    test "reports a missing project rather than succeeding silently" do
      assert :missing = Projects.update(999, %{name: "No such", description: "d"})
    end
  end

  describe "remove/1" do
    test "deletes a project with no tasks" do
      {:ok, %{id: id}} = Projects.create(%{name: "Short-lived project", description: "d"})

      assert :ok = Projects.remove(id)
      assert Projects.get(id) == nil
    end

    test "refuses a project that still has tasks, with the reference's guard" do
      assert {:error, {:restricted, singular}} = Projects.remove(3)

      assert singular ==
               "This project still has 1 task. Delete it before deleting the project."

      assert {:error, {:restricted, plural}} = Projects.remove(1)

      assert plural ==
               "This project still has 3 tasks. Delete them before deleting the project."

      # The refused delete changed nothing.
      assert Projects.get(1) != nil
    end

    test "reports a missing project" do
      assert :missing = Projects.remove(999)
    end
  end
end
