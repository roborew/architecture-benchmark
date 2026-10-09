defmodule PhoenixRest.Users.Validator do
  # Input validation for the users surface, kept pure so it can be unit tested
  # without any Plug or database: the JSON body of create/update. The zod
  # rules and their message strings are ported verbatim from the reference
  # variant's UserSchema (apps/tanstack-start-react/src/lib/actions.ts), so a
  # client that rendered the reference app's validation errors renders ours
  # unchanged.
  @moduledoc """
  Parses the create/update user body (`{name, email}`).

  Returns `{:ok, %{name: _, email: _}}` with trimmed values, or
  `{:error, errors}` where `errors` maps the body's field names to the
  reference's message strings verbatim.
  """

  import PhoenixRest.Validation, only: [expected_string: 1]

  @name_max 200

  # zod's default email regex (zod v4 docs, "Emails"), verbatim.
  @email_regex ~r/^(?!\.)(?!.*\.\.)([a-z0-9_'+\-\.]*)[a-z0-9_+-]@([a-z0-9][a-z0-9\-]*\.)+[a-z]{2,}$/i

  @spec parse_body(term()) ::
          {:ok, %{name: String.t(), email: String.t()}}
          | {:error, %{optional(String.t()) => [String.t()]}}
  def parse_body(raw) do
    # A non-object body has no fields (the reference's asBody).
    params = if is_map(raw), do: raw, else: %{}

    # An absent field reads back as null — the same value the reference's
    # formData.get returns for a field the form did not submit.
    name = Map.get(params, "name")
    email = Map.get(params, "email")

    errors =
      %{}
      |> put_errors("name", name_errors(name))
      |> put_errors("email", email_errors(email))

    if errors == %{} do
      {:ok, %{name: String.trim(name), email: String.trim(email)}}
    else
      {:error, errors}
    end
  end

  # An empty name reaches the min rule; an omitted one fails zod's own type
  # check first, exactly as the reference's FormData parse does.
  defp name_errors(nil), do: [expected_string(nil)]

  defp name_errors(name) when is_binary(name) do
    name = String.trim(name)

    cond do
      name == "" -> ["User name is required."]
      String.length(name) > @name_max -> ["User name must be #{@name_max} characters or fewer."]
      true -> []
    end
  end

  defp name_errors(other), do: [expected_string(other)]

  # An empty email fails both the min rule and the format rule: zod collects
  # every issue in the chain, and so does the reference's parse of an empty
  # submitted field.
  defp email_errors(nil), do: [expected_string(nil)]

  defp email_errors(email) when is_binary(email) do
    email = String.trim(email)

    errors = if email == "", do: ["Email is required."], else: []

    if email =~ @email_regex do
      errors
    else
      errors ++ ["Enter a valid email address."]
    end
  end

  defp email_errors(other), do: [expected_string(other)]

  defp put_errors(acc, _field, []), do: acc
  defp put_errors(acc, field, messages), do: Map.put(acc, field, messages)
end
