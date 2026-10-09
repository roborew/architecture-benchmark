defmodule PhoenixRestWeb.ApiError do
  # The typed error a controller returns for every outcome the API answers with
  # something other than a 2xx: the HTTP status plus the exact JSON payload the
  # client should receive. Ported from the reference variant's HttpError
  # (src/lib/http-error.ts).
  #
  # Controllers write successes to the response and return `{:error, %ApiError{}}`
  # for failures; PhoenixRestWeb.FallbackController maps the struct onto
  # `put_status/2` + `json/2`. That keeps the JSON error envelope ({ error, ... })
  # described in exactly one place — the controller that decided the outcome —
  # instead of being re-derived from a message deep in the stack, and it lets the
  # pure validators produce plain data that the controller wraps.
  @moduledoc false

  @type t :: %__MODULE__{status: pos_integer(), payload: map()}

  defstruct [:status, :payload]

  @doc "400 with the plain `{ error }` envelope (bad query or route param)."
  @spec bad_request(String.t()) :: t()
  def bad_request(error), do: %__MODULE__{status: 400, payload: %{"error" => error}}

  @doc "400 with the field → messages envelope a body validation failure produces."
  @spec validation(String.t(), %{optional(String.t()) => [String.t()]}) :: t()
  def validation(error, errors) do
    %__MODULE__{status: 400, payload: %{"error" => error, "errors" => errors}}
  end

  @doc "404 with the API's plain `{ error }` envelope."
  @spec not_found(String.t()) :: t()
  def not_found(error), do: %__MODULE__{status: 404, payload: %{"error" => error}}

  @doc "409 with the reference's FK guard message."
  @spec conflict(String.t()) :: t()
  def conflict(error), do: %__MODULE__{status: 409, payload: %{"error" => error}}
end
