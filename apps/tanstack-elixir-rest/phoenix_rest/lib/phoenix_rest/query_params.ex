defmodule PhoenixRest.QueryParams do
  # Input validation for the `q` search param and the `:id` route param, shared
  # by every read surface — ported from the reference variant's
  # src/lib/query.validator.ts, kept pure so it can be unit tested without any
  # Plug or database.
  @moduledoc """
  Parses the query and route params every surface shares.

  * `parse_query/1` — the raw query string into an Express-style param map,
    where a repeated param is collected into a list rather than collapsed.
  * `parse_search_term/1` — the `q` search term, `{:ok, term}` or
    `{:error, message}`.
  * `parse_id_param/1` — the `:id` a detail/update/delete URL names,
    `{:ok, id}` or `{:error, message}`.
  """

  @max_search_term_length 100
  @id_error "id must be a positive integer"

  @doc """
  Parses a raw query string into a param map, Express-style.

  Plug's decoder collapses repeated params to the last value; the reference's
  validators reject a repeat (`q must be a single value`), so this parser keeps
  them as a list in arrival order for the validators to see. Keys and values
  are percent-decoded; a bare key reads back as an empty value, like the
  reference's `URLSearchParams`.
  """
  @spec parse_query(binary()) :: %{optional(String.t()) => binary() | [binary()]}
  def parse_query(query_string) when is_binary(query_string) do
    query_string
    |> String.split("&", trim: true)
    |> Enum.map(&decode_pair/1)
    |> Enum.reduce(%{}, &group_pair/2)
    |> Map.new(fn {key, values} -> {key, unwrap(values)} end)
  end

  defp decode_pair(part) do
    case :binary.split(part, "=") do
      [key, value] -> {URI.decode_www_form(key), URI.decode_www_form(value)}
      [key] -> {URI.decode_www_form(key), ""}
    end
  end

  # Values accumulate on the head, so a list is reversed before it is handed
  # back — the order the client sent is part of what a repeat reveals.
  defp group_pair({key, value}, acc), do: Map.update(acc, key, [value], &[value | &1])

  defp unwrap([value]), do: value
  defp unwrap(values), do: Enum.reverse(values)

  @doc """
  Parses the raw `q` query value.

  Absent, empty and whitespace-only values are valid and mean "no filter" — a
  bare URL (`/api/users`) and a cleared field (`/api/users?q=`) must both list
  every member. A repeated param arrives as a list and is rejected: silently
  picking one of the two values would hide the client bug.
  """
  @spec parse_search_term(term()) :: {:ok, String.t()} | {:error, String.t()}
  def parse_search_term(raw)

  def parse_search_term(nil), do: {:ok, ""}

  def parse_search_term(raw) when is_binary(raw) do
    term = String.trim(raw)

    if String.length(term) > @max_search_term_length do
      {:error, "q must be at most #{@max_search_term_length} characters"}
    else
      {:ok, term}
    end
  end

  def parse_search_term(_repeated_or_non_string), do: {:error, "q must be a single value"}

  @doc """
  Parses a raw `:id` route param.

  A detail/update/delete URL names a row by primary key, so anything that is
  not a positive integer cannot name one. Rejecting it here — rather than
  binding it and letting Postgres fail the cast — keeps the response a clear
  400 envelope instead of a 500.
  """
  @spec parse_id_param(term()) :: {:ok, integer()} | {:error, String.t()}
  def parse_id_param(raw) when is_binary(raw) do
    if Regex.match?(~r/^\d+$/, raw) do
      id = String.to_integer(raw)

      if id >= 1, do: {:ok, id}, else: {:error, @id_error}
    else
      {:error, @id_error}
    end
  end

  # A param that is not a binary (a repeated value that arrived as a list)
  # cannot name a row either.
  def parse_id_param(_non_string), do: {:error, @id_error}
end
