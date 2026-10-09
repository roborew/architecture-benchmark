defmodule PhoenixRest.QueryParamsTest do
  # Input validation for the `q` search param and the `:id` route param —
  # ported from the reference variant's src/lib/query.validator.ts, kept pure
  # so it can be unit tested without any Plug or database.
  #
  # parse_query/1 exists because Plug collapses repeated query params
  # (?q=a&q=b → the last value), while the reference's Express query object
  # collects them into an array and its validators reject the repeat: silently
  # picking one of the two values would hide the client bug.
  use ExUnit.Case, async: true

  alias PhoenixRest.QueryParams

  describe "parse_query/1" do
    test "decodes keys and values" do
      assert QueryParams.parse_query("q=%20%20Robin%20Andrew%20%20&status=todo") == %{
               "q" => "  Robin Andrew  ",
               "status" => "todo"
             }
    end

    test "keeps repeated params as a list, in the order they arrived" do
      assert QueryParams.parse_query("q=robin&q=sam") == %{"q" => ["robin", "sam"]}
    end

    test "an empty query string is no params" do
      assert QueryParams.parse_query("") == %{}
    end

    test "a bare key reads back as an empty value" do
      assert QueryParams.parse_query("q") == %{"q" => ""}
    end
  end

  describe "parse_search_term/1" do
    test "absent, empty and whitespace-only values mean no filter" do
      assert QueryParams.parse_search_term(nil) == {:ok, ""}
      assert QueryParams.parse_search_term("") == {:ok, ""}
      assert QueryParams.parse_search_term("   ") == {:ok, ""}
    end

    test "trims the term" do
      assert QueryParams.parse_search_term("  navigation  ") == {:ok, "navigation"}
    end

    test "rejects a repeated term" do
      assert QueryParams.parse_search_term(["a", "b"]) ==
               {:error, "q must be a single value"}
    end

    test "rejects a term longer than 100 characters" do
      assert QueryParams.parse_search_term(String.duplicate("a", 101)) ==
               {:error, "q must be at most 100 characters"}
    end
  end

  describe "parse_id_param/1" do
    test "accepts a positive integer" do
      assert QueryParams.parse_id_param("101") == {:ok, 101}
      assert QueryParams.parse_id_param("1") == {:ok, 1}
    end

    test "rejects anything that cannot name a row" do
      # A detail/update/delete URL names a row by primary key, so anything
      # that is not a positive integer cannot name one — answered as a clear
      # 400 envelope instead of failing the cast in Postgres.
      assert QueryParams.parse_id_param("abc") ==
               {:error, "id must be a positive integer"}

      assert QueryParams.parse_id_param("1.5") ==
               {:error, "id must be a positive integer"}

      assert QueryParams.parse_id_param("-7") ==
               {:error, "id must be a positive integer"}

      assert QueryParams.parse_id_param("0") ==
               {:error, "id must be a positive integer"}
    end
  end
end
