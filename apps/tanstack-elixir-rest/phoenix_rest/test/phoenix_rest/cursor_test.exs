defmodule PhoenixRest.CursorTest do
  # The keyset cursor, ported from the reference variant along with its tests
  # (src/lib/cursor.ts, tests/unit/cursor.test.ts). spec/queries.md requires the
  # "older" link to carry an opaque cursor for `(created_at, id)`. Opaque means
  # the page does not have to know how the tuple is packed, so these tests pin
  # the round-trip and the failure behaviour rather than the exact bytes.
  use ExUnit.Case, async: true

  alias PhoenixRest.Cursor

  describe "encode/2" do
    test "round-trips a timestamp and id" do
      cursor = Cursor.encode("2026-09-28T10:15:00.000000Z", 101)

      assert Cursor.decode(cursor) == %{
               created_at: "2026-09-28T10:15:00.000000Z",
               id: 101
             }
    end

    test "is stable, so the same page cursor yields the same page" do
      # spec/queries.md requires the cursor be "stable and repeatable".
      first = Cursor.encode("2026-09-28T10:15:00.000000Z", 101)
      second = Cursor.encode("2026-09-28T10:15:00.000000Z", 101)

      assert first == second
    end

    test "produces a value safe to put in a query string" do
      cursor = Cursor.encode("2026-09-28T10:15:00.000000Z", 101)

      assert cursor =~ ~r/^[A-Za-z0-9_-]+$/
      assert URI.encode_www_form(cursor) == cursor
    end

    test "distinguishes cursors that differ only by id" do
      # The id is the tiebreaker for rows sharing a created_at, so dropping it
      # would make two different pages resolve to the same cursor.
      a = Cursor.encode("2026-09-28T10:15:00.000000Z", 101)
      b = Cursor.encode("2026-09-28T10:15:00.000000Z", 102)

      assert a != b
    end
  end

  describe "decode/1" do
    test "returns nil for an absent cursor" do
      assert Cursor.decode(nil) == nil
      assert Cursor.decode("") == nil
    end

    test "returns nil for a cursor that was not produced by encode/2" do
      # A hand-edited or stale cursor must not reach the query: it would either
      # throw or, worse, silently select the wrong page. The model then reads
      # the first page instead of failing the request.
      assert Cursor.decode("not-a-cursor") == nil
      assert Cursor.decode("!!!!") == nil
    end

    test "returns nil for a well-formed payload with a non-numeric id" do
      forged = Base.url_encode64("2026-09-28T10:15:00.000000Z|abc", padding: false)

      assert Cursor.decode(forged) == nil
    end
  end
end
