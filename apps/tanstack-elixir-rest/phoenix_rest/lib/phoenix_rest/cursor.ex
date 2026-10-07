defmodule PhoenixRest.Cursor do
  # Keyset pagination cursor, ported from the reference variant
  # (apps/tanstack-express-rest/express-rest/src/lib/cursor.ts).
  #
  # spec/queries.md: "an 'older' link carrying an opaque cursor for
  # `(created_at, id)`; it must be stable and repeatable (same cursor → same
  # page)". Keyset rather than OFFSET so a page costs the same whether it is the
  # first or the hundredth, and so an insert during paging cannot shift rows
  # onto a page the reader has already seen.
  #
  # The tuple is packed into one base64url string because a raw
  # `2026-09-28T10:15:00.000000Z|101` contains characters that would have to be
  # percent-encoded in the `?cursor=` query parameter, and the contract calls the
  # cursor opaque — the page should not need to know how it is packed.
  #
  # Pure by design: no database, no Plug, so the unit suite can pin the packing
  # and the contexts can share it without either importing the other.
  @moduledoc """
  The opaque keyset pagination cursor for the `(created_at, id)` tuple.

  `encode/2` packs `created_at` and `id` into one base64url string;
  `decode/1` unpacks it, or returns `nil` when there is nothing usable to
  decode (the caller then reads the first page).
  """

  @separator "|"

  @spec encode(binary(), integer()) :: String.t()
  def encode(created_at, id) when is_binary(created_at) and is_integer(id) do
    Base.url_encode64(created_at <> @separator <> Integer.to_string(id), padding: false)
  end

  @spec decode(nil | binary()) :: %{created_at: String.t(), id: integer()} | nil
  def decode(nil), do: nil
  # An empty cursor is the first page, like an absent one.
  def decode(""), do: nil

  def decode(value) when is_binary(value) do
    with {:ok, decoded} <- Base.url_decode64(value, padding: false),
         {created_at, id} <- split_payload(decoded),
         true <- created_at != "",
         {id, ""} <- Integer.parse(id) do
      %{created_at: created_at, id: id}
    else
      _ -> nil
    end
  end

  # The separator is matched on its LAST occurrence, like the reference's
  # lastIndexOf, so a timestamp that itself contained the separator could not
  # smuggle a forged id.
  defp split_payload(decoded) do
    case String.split(decoded, @separator) do
      [_single] ->
        :error

      parts ->
        {id, created_at_parts} = List.pop_at(parts, -1)
        {Enum.join(created_at_parts, @separator), id}
    end
  end
end
