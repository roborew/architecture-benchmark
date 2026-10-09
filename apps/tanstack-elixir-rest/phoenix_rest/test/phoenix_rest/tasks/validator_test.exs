defmodule PhoenixRest.Tasks.ValidatorTest do
  # The tasks validator's pure contract: the list query params, and the write
  # bodies. The zod message strings are pinned verbatim against the reference
  # variant's actions.ts (TaskSchema / CommentSchema) — a drift here is a
  # client-visible change to the API's error contract. No database, no Plug.
  use ExUnit.Case, async: true

  alias PhoenixRest.Tasks.Validator

  describe "parse_status/1" do
    test "accepts each stored status value, and treats absent/empty as no filter" do
      assert Validator.parse_status(nil) == {:ok, ""}
      assert Validator.parse_status("") == {:ok, ""}
      assert Validator.parse_status(" todo ") == {:ok, "todo"}
      assert Validator.parse_status("in progress") == {:ok, "in progress"}
      assert Validator.parse_status("done") == {:ok, "done"}
    end

    test "rejects an unknown status with the reference's thrown message" do
      assert Validator.parse_status("bogus") == {:error, "Unknown task status: bogus"}
    end

    test "rejects a repeated status param" do
      assert Validator.parse_status(["todo", "done"]) ==
               {:error, "status must be a single value"}
    end
  end

  describe "parse_list_query/1" do
    test "parses every filter at once" do
      assert Validator.parse_list_query(%{
               "q" => "navigation",
               "status" => "todo",
               "projectId" => "1",
               "assigneeId" => "2",
               "cursor" => "abc",
               "limit" => "10"
             }) ==
               {:ok,
                %{
                  search: "navigation",
                  status: "todo",
                  project_id: 1,
                  assignee_id: 2,
                  cursor: "abc",
                  limit: 10
                }}
    end

    test "treats an absent everything as the unfiltered first page" do
      assert Validator.parse_list_query(%{}) ==
               {:ok,
                %{
                  search: "",
                  status: "",
                  project_id: nil,
                  assignee_id: nil,
                  cursor: nil,
                  limit: nil
                }}
    end

    test "keeps the reference's q envelopes for malformed q" do
      assert Validator.parse_list_query(%{"q" => ["a", "b"]}) ==
               {:error, "q must be a single value"}

      assert Validator.parse_list_query(%{"q" => String.duplicate("a", 101)}) ==
               {:error, "q must be at most 100 characters"}
    end

    test "rejects non-integer filter ids" do
      assert Validator.parse_list_query(%{"projectId" => "one"}) ==
               {:error, "projectId must be an integer"}

      assert Validator.parse_list_query(%{"assigneeId" => "1.5"}) ==
               {:error, "assigneeId must be an integer"}

      assert Validator.parse_list_query(%{"assigneeId" => ["1", "2"]}) ==
               {:error, "assigneeId must be a single value"}
    end

    test "rejects a non-integer or repeated limit" do
      assert Validator.parse_list_query(%{"limit" => "many"}) ==
               {:error, "limit must be an integer"}

      assert Validator.parse_list_query(%{"limit" => ["1", "2"]}) ==
               {:error, "limit must be a single value"}
    end
  end

  describe "parse_project_list_query/1" do
    test "parses status, cursor and limit" do
      assert Validator.parse_project_list_query(%{
               "status" => "todo",
               "cursor" => "x",
               "limit" => "2"
             }) ==
               {:ok, %{status: "todo", cursor: "x", limit: 2}}
    end

    test "shares the workspace list's status rejection" do
      assert Validator.parse_project_list_query(%{"status" => "nope"}) ==
               {:error, "Unknown task status: nope"}
    end
  end

  describe "parse_fields/1" do
    test "accepts the task fields and trims title and description" do
      assert Validator.parse_fields(%{
               "title" => "  Draft navigation model  ",
               "description" => "  Map the structure  ",
               "status" => "todo"
             }) ==
               {:ok,
                %{
                  title: "Draft navigation model",
                  description: "Map the structure",
                  status: "todo"
                }}
    end

    test "treats an omitted description as empty, like an unsubmitted form field" do
      assert Validator.parse_fields(%{"title" => "T", "status" => "todo"}) ==
               {:ok, %{title: "T", description: "", status: "todo"}}
    end

    test "produces the reference's field messages verbatim" do
      assert Validator.parse_fields(%{"title" => "", "status" => "todo"}) ==
               {:error, %{"title" => ["Title is required."]}}

      assert Validator.parse_fields(%{"title" => String.duplicate("a", 201), "status" => "todo"}) ==
               {:error, %{"title" => ["Title must be 200 characters or fewer."]}}

      assert Validator.parse_fields(%{"title" => "T", "status" => "bogus"}) ==
               {:error, %{"status" => ["Choose a valid status."]}}

      # Every field's issues are collected, like the reference's zod parse.
      assert Validator.parse_fields(%{"description" => "d", "status" => "later"}) ==
               {:error,
                %{
                  "title" => ["Invalid input: expected string, received null"],
                  "status" => ["Choose a valid status."]
                }}
    end

    test "reports an omitted title exactly as the reference's FormData does" do
      assert Validator.parse_fields(%{"status" => "todo"}) ==
               {:error, %{"title" => ["Invalid input: expected string, received null"]}}
    end
  end

  describe "parse_create_refs/1" do
    test "accepts integer ids and keeps a null assignee nullable" do
      assert Validator.parse_create_refs(%{"projectId" => 1, "assigneeId" => 2}) ==
               {:ok, %{project_id: 1, assignee_id: 2}}

      assert Validator.parse_create_refs(%{"projectId" => "1", "assigneeId" => nil}) ==
               {:ok, %{project_id: 1, assignee_id: nil}}

      assert Validator.parse_create_refs(%{"projectId" => 1, "assigneeId" => ""}) ==
               {:ok, %{project_id: 1, assignee_id: nil}}
    end

    test "produces the reference's choose-a-project / choose-an-assignee errors" do
      assert Validator.parse_create_refs(%{"assigneeId" => 1}) ==
               {:error, %{"projectId" => ["Choose a project."]}}

      assert Validator.parse_create_refs(%{"projectId" => 1, "assigneeId" => "x"}) ==
               {:error, %{"assigneeId" => ["Choose a valid assignee."]}}

      assert Validator.parse_create_refs(%{"projectId" => 1.5, "assigneeId" => 1.5}) ==
               {:error,
                %{
                  "projectId" => ["Choose a project."],
                  "assigneeId" => ["Choose a valid assignee."]
                }}
    end
  end

  describe "parse_update_assignee/1" do
    test "treats absent, null and empty as unassigned" do
      assert Validator.parse_update_assignee(%{}) == {:ok, %{assignee_id: nil}}
      assert Validator.parse_update_assignee(%{"assigneeId" => nil}) == {:ok, %{assignee_id: nil}}
      assert Validator.parse_update_assignee(%{"assigneeId" => ""}) == {:ok, %{assignee_id: nil}}
      assert Validator.parse_update_assignee(%{"assigneeId" => 3}) == {:ok, %{assignee_id: 3}}
    end

    test "rejects a non-integer assignee" do
      assert Validator.parse_update_assignee(%{"assigneeId" => "nope"}) ==
               {:error, %{"assigneeId" => ["Choose a valid assignee."]}}
    end
  end

  describe "parse_with_comment_fields/1" do
    test "accepts a comment body and author" do
      assert Validator.parse_with_comment_fields(%{
               "commentBody" => " A note ",
               "commentAuthorId" => 2
             }) == {:ok, %{comment_body: "A note", comment_author_id: 2}}
    end

    test "coerces a string author, as the reference's <select> submits it" do
      assert Validator.parse_with_comment_fields(%{
               "commentBody" => "A note",
               "commentAuthorId" => "2"
             }) == {:ok, %{comment_body: "A note", comment_author_id: 2}}
    end

    test "produces the reference's comment messages verbatim" do
      assert Validator.parse_with_comment_fields(%{"commentAuthorId" => 2}) ==
               {:error, %{"commentBody" => ["Comment is required."]}}

      assert Validator.parse_with_comment_fields(%{
               "commentBody" => String.duplicate("a", 1001),
               "commentAuthorId" => 2
             }) ==
               {:error, %{"commentBody" => ["Comment must be 1000 characters or fewer."]}}
    end

    test "reports an omitted author exactly as the reference's FormData does" do
      # z.coerce.number() of null coerces to 0, which fails the positive rule —
      # the reference's own message for an unsubmitted <select>.
      assert Validator.parse_with_comment_fields(%{"commentBody" => "A note"}) ==
               {:error, %{"commentAuthorId" => ["Too small: expected number to be >0"]}}
    end
  end

  describe "parse_comment_body/1" do
    test "accepts a body and author keyed by this endpoint's field names" do
      assert Validator.parse_comment_body(%{"body" => " A note ", "authorId" => 1}) ==
               {:ok, %{body: "A note", author_id: 1}}
    end

    test "carries the same rule strings, keyed by the request's fields" do
      assert Validator.parse_comment_body(%{"authorId" => 1}) ==
               {:error, %{"body" => ["Comment is required."]}}

      assert Validator.parse_comment_body(%{
               "body" => String.duplicate("a", 1001),
               "authorId" => 1
             }) ==
               {:error, %{"body" => ["Comment must be 1000 characters or fewer."]}}
    end
  end
end
