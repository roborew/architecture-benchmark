defmodule PhoenixRest.SQL do
  # A tiny SQL fragment accumulator, the Elixir stand-in for the reference
  # variant's postgres.js tagged templates.
  #
  # The reference composes statements by interpolating one fragment into
  # another (`db`${USER_AGGREGATES} ${where} GROUP BY …``), and postgres.js
  # renumbers the placeholders as it flattens them. Elixir has no such
  # composition, so a statement is built as a list of `{sql, params}` fragments
  # and `compile/1` does the flattening: it joins the fragments and rewrites
  # each `?` to the matching `$n`.
  #
  # `?` rather than `$n` inside a fragment is what makes composition possible —
  # a fragment cannot know its offset until it is placed. All values travel as
  # parameters; only locally-clamped integers (paging limits) are ever inlined.
  @moduledoc false

  @typedoc "One fragment: its SQL and the parameters its `?` placeholders bind."
  @type fragment :: {String.t(), [term()]}

  @typedoc "An ordered list of fragments making up one statement."
  @type t :: [fragment()]

  @doc "An empty fragment accumulator."
  @spec new() :: t()
  def new, do: []

  @doc "Appends one fragment, unconditionally."
  @spec fragment(t(), String.t(), [term()]) :: t()
  def fragment(acc, sql, params \\ []) when is_binary(sql) do
    acc ++ [{sql, params}]
  end

  @doc """
  Appends a fragment only when `condition` is truthy.

  `nil` and `false` are the two "no fragment" values, so a caller can pass the
  result of a comparison directly (an absent search term, an unset filter).
  """
  @spec add(t(), term(), String.t(), [term()]) :: t()
  def add(acc, condition, sql, params \\ [])

  def add(acc, condition, _sql, _params) when condition in [nil, false], do: acc
  def add(acc, _condition, sql, params), do: acc ++ [{sql, params}]

  @doc """
  Flattens the fragments into one statement, renumbering placeholders.

  Every `?` in every fragment becomes `$1`, `$2`, … in textual order, and the
  fragments' parameters are concatenated in the same order, so the returned
  `{sql, params}` binds exactly.
  """
  @spec compile(t()) :: {String.t(), [term()]}
  def compile(fragments) do
    {sql_parts, params, _next} =
      Enum.reduce(fragments, {[], [], 1}, fn {sql, fragment_params}, {parts, acc, next} ->
        {sql, next} = renumber(sql, next)
        {[sql | parts], acc ++ fragment_params, next}
      end)

    {sql_parts |> Enum.reverse() |> Enum.join("\n"), params}
  end

  # Replaces each `?` with the next `$n`, returning the rewritten fragment and
  # the index the following fragment starts from. Fragments are trusted SQL, so
  # they never contain a literal `?`.
  defp renumber(sql, start) do
    {pieces, next} =
      sql
      |> String.split("?")
      |> Enum.with_index()
      |> Enum.map_reduce(start, fn
        {part, 0}, index -> {part, index}
        {part, _after_placeholder}, index -> {"$#{index}" <> part, index + 1}
      end)

    {Enum.join(pieces), next}
  end

  @doc """
  Escapes `\\`, `%` and `_` so a LIKE/ILIKE pattern treats them literally.

  ILIKE reads those three as wildcards, so a search for `100%` must not match
  every row. The escaped term is wrapped in `%…%` by the caller.
  """
  @spec escape_like(String.t()) :: String.t()
  def escape_like(term) when is_binary(term) do
    Regex.replace(~r/[\\%_]/, term, fn match -> "\\" <> match end)
  end
end
