defmodule PhoenixRest.Validation do
  # The reference variant's validators are zod schemas, and their default
  # type-check messages ("Invalid input: expected string, received null") are
  # part of this API's error contract — the frontend renders them verbatim.
  # The spelling lives here once so the per-domain validators cannot drift.
  @moduledoc """
  Shared zod-style validation helpers.

  `expected_string/1` produces the zod type-check failure message verbatim,
  for the "a field the form did not submit reads back as null" contract the
  reference's FormData parse establishes.
  """

  @doc "The zod type name of a raw JSON value, as it appears in zod's messages."
  @spec js_type_name(term()) :: String.t()
  def js_type_name(nil), do: "null"
  def js_type_name(value) when is_integer(value) or is_float(value), do: "number"
  def js_type_name(value) when is_boolean(value), do: "boolean"
  def js_type_name(value) when is_list(value), do: "array"
  def js_type_name(value) when is_map(value), do: "object"
  def js_type_name(value) when is_binary(value), do: "string"

  @doc "The zod string type-check message, verbatim."
  @spec expected_string(term()) :: String.t()
  def expected_string(value),
    do: "Invalid input: expected string, received #{js_type_name(value)}"
end
