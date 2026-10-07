defmodule PhoenixRest.Projects.Validator do
  # Input validation for the projects surface, kept pure so it can be unit
  # tested without any Plug or database: the JSON body of create/update. The
  # zod rules and their message strings are ported verbatim from the
  # reference variant's ProjectSchema (apps/tanstack-start-react/src/lib/
  # actions.ts), so a client that rendered the reference app's validation
  # errors renders ours unchanged.
  @moduledoc """
  Parses the create/update project body (`{name, description}`).

  Returns `{:ok, %{name: _, description: _}}` with trimmed values, or
  `{:error, errors}` where `errors` maps the body's field names to the
  reference's message strings verbatim.

  Note the asymmetry with tasks: the reference's ProjectSchema does NOT
  preprocess `description`, so a body that omits it is a validation failure
  ("Invalid input: expected string, received null") exactly as it is there.
  """

  import PhoenixRest.Validation, only: [expected_string: 1]

  @name_max 200

  @spec parse_body(term()) ::
          {:ok, %{name: String.t(), description: String.t()}}
          | {:error, %{optional(String.t()) => [String.t()]}}
  def parse_body(raw) do
    # A non-object body has no fields (the reference's asBody).
    params = if is_map(raw), do: raw, else: %{}

    # An absent field reads back as null — the same value the reference's
    # formData.get returns for a field the form did not submit.
    name = Map.get(params, "name")
    description = Map.get(params, "description")

    errors =
      %{}
      |> put_errors("name", name_errors(name))
      |> put_errors("description", description_errors(description))

    if errors == %{} do
      {:ok, %{name: String.trim(name), description: String.trim(description)}}
    else
      {:error, errors}
    end
  end

  # The schema puts no limit on projects.name, but tasks.title caps at 200,
  # and the reference's ProjectSchema caps the name at 200 too.
  defp name_errors(nil), do: [expected_string(nil)]

  defp name_errors(name) when is_binary(name) do
    name = String.trim(name)

    cond do
      name == "" ->
        ["Project name is required."]

      String.length(name) > @name_max ->
        ["Project name must be #{@name_max} characters or fewer."]

      true ->
        []
    end
  end

  defp name_errors(other), do: [expected_string(other)]

  # No preprocess: an omitted description is a type failure, and an empty one
  # is legal (the column defaults to '').
  defp description_errors(nil), do: [expected_string(nil)]
  defp description_errors(description) when is_binary(description), do: []
  defp description_errors(other), do: [expected_string(other)]

  defp put_errors(acc, _field, []), do: acc
  defp put_errors(acc, field, messages), do: Map.put(acc, field, messages)
end
