defmodule PhoenixRest.Users.ValidatorTest do
  # The users validator's pure contract: the create/update body. The zod
  # message strings are pinned verbatim against the reference variant's
  # UserSchema (actions.ts) — a drift here is a client-visible change to the
  # API's error contract. No database, no Plug.
  #
  # `users.email` has no UNIQUE constraint (spec/schema.sql) and
  # spec/contract.md requires none, so no uniqueness rule is imposed here — two
  # members may legitimately share an address. The address is still
  # shape-checked because the form declares `type="email"` and the server
  # should agree.
  use ExUnit.Case, async: true

  alias PhoenixRest.Users.Validator

  describe "parse_body/1" do
    test "accepts a name and email, trimmed" do
      assert Validator.parse_body(%{
               "name" => "  Robin Andrew  ",
               "email" => "  robin@example.test  "
             }) == {:ok, %{name: "Robin Andrew", email: "robin@example.test"}}
    end

    test "produces the reference's messages verbatim" do
      # An empty name reaches the min rule; an omitted one fails zod's own
      # type check first, exactly as the reference's FormData parse does.
      assert Validator.parse_body(%{"name" => "", "email" => "robin@example.test"}) ==
               {:error, %{"name" => ["User name is required."]}}

      assert Validator.parse_body(%{
               "name" => String.duplicate("a", 201),
               "email" => "e@x.test"
             }) ==
               {:error, %{"name" => ["User name must be 200 characters or fewer."]}}

      # An empty email fails both the min rule and the format rule: zod
      # collects every issue in the chain, and so does the reference's parse
      # of an empty submitted field.
      assert Validator.parse_body(%{"name" => "Robin", "email" => ""}) ==
               {:error, %{"email" => ["Email is required.", "Enter a valid email address."]}}

      assert Validator.parse_body(%{"name" => "Robin", "email" => "not-an-address"}) ==
               {:error, %{"email" => ["Enter a valid email address."]}}
    end

    test "reports omitted fields exactly as the reference's FormData does" do
      # An absent field reads back as null — the same value the reference's
      # formData.get returns for a field the form did not submit — so zod's
      # own messages match the reference's one-for-one.
      assert Validator.parse_body(%{}) ==
               {:error,
                %{
                  "name" => ["Invalid input: expected string, received null"],
                  "email" => ["Invalid input: expected string, received null"]
                }}
    end
  end
end
