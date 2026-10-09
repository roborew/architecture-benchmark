defmodule PhoenixRest.Projects.ValidatorTest do
  # The projects validator's pure contract: the create/update body. The zod
  # message strings are pinned verbatim against the reference variant's
  # ProjectSchema (actions.ts) — a drift here is a client-visible change to the
  # API's error contract. No database, no Plug.
  #
  # Note the asymmetry with tasks: the reference's ProjectSchema does NOT
  # preprocess `description`, so a body that omits it is a validation failure
  # ("Invalid input: expected string, received null") exactly as it is there.
  use ExUnit.Case, async: true

  alias PhoenixRest.Projects.Validator

  describe "parse_body/1" do
    test "accepts a name and description, trimmed" do
      assert Validator.parse_body(%{
               "name" => "  Website redesign  ",
               "description" => "  A refresh  "
             }) == {:ok, %{name: "Website redesign", description: "A refresh"}}
    end

    test "produces the reference's name messages verbatim" do
      # An empty name reaches the min rule; an omitted one fails zod's own
      # type check first, exactly as the reference's FormData parse does.
      assert Validator.parse_body(%{"name" => "", "description" => "d"}) ==
               {:error, %{"name" => ["Project name is required."]}}

      assert Validator.parse_body(%{"name" => "  ", "description" => "d"}) ==
               {:error, %{"name" => ["Project name is required."]}}

      assert Validator.parse_body(%{
               "name" => String.duplicate("a", 201),
               "description" => "d"
             }) ==
               {:error, %{"name" => ["Project name must be 200 characters or fewer."]}}
    end

    test "requires a description, exactly as the reference's schema does" do
      # The reference's ProjectSchema does not preprocess description, so an
      # omitted field is a type failure — not silently an empty description.
      assert Validator.parse_body(%{"name" => "Website redesign"}) ==
               {:error, %{"description" => ["Invalid input: expected string, received null"]}}

      # An empty description is legal (the column defaults to ''), and only an
      # omitted one is a failure.
      assert Validator.parse_body(%{"name" => "n", "description" => ""}) ==
               {:ok, %{name: "n", description: ""}}
    end
  end
end
