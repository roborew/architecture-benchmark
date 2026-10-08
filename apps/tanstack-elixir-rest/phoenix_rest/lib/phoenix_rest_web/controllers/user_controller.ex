defmodule PhoenixRestWeb.UserController do
  # The controller layer for users: validates the request, translates it into a
  # context call, and writes the result to the response. It knows Plug and
  # nothing about SQL; the context knows SQL and nothing about HTTP.
  #
  # Validation lives in PhoenixRest.Users.Validator (bodies) and
  # PhoenixRest.QueryParams (q / :id). Failures are returned as ApiError and
  # mapped to their JSON envelope by the fallback controller; successes are
  # written here, including the `redirectTo` the reference's actions return,
  # which is where the SPA navigates next.
  @moduledoc false

  use PhoenixRestWeb, :controller

  alias PhoenixRest.{QueryParams, Users}
  alias PhoenixRest.Users.Validator
  alias PhoenixRestWeb.{ApiError, Params}

  action_fallback PhoenixRestWeb.FallbackController

  @doc "GET /api/users?q=… — the People listing page's rows."
  def index(conn, _params) do
    case conn |> Params.search_term() |> QueryParams.parse_search_term() do
      {:ok, term} -> json(conn, Users.list(term))
      {:error, message} -> {:error, ApiError.bad_request(message)}
    end
  end

  @doc "GET /api/users/:id — one member with the same shape `list` returns."
  def show(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw),
         %{} = user <- Users.get(id) do
      json(conn, user)
    else
      {:error, error} -> {:error, error}
      nil -> {:error, ApiError.not_found("Not found")}
    end
  end

  @doc "GET /api/users/:id/tasks — the tasks assigned to one member."
  def tasks(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      json(conn, Users.list_tasks(id))
    end
  end

  @doc "POST /api/users — insert one member, redirect to their page."
  def create(conn, _params) do
    case Validator.parse_body(conn.body_params) do
      {:ok, data} ->
        {:ok, %{id: id}} = Users.create(data)

        conn
        |> put_status(201)
        |> json(%{"ok" => true, "message" => "User created.", "redirectTo" => "/users/#{id}"})

      {:error, errors} ->
        {:error, ApiError.validation("Missing fields. Failed to create user.", errors)}
    end
  end

  @doc "PATCH /api/users/:id — update one member by primary key."
  def update(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      case Validator.parse_body(conn.body_params) do
        {:ok, data} ->
          case Users.update(id, data) do
            :ok ->
              json(conn, %{
                "ok" => true,
                "message" => "User updated.",
                "redirectTo" => "/users/#{id}"
              })

            :missing ->
              {:error, ApiError.not_found("That user no longer exists.")}
          end

        {:error, errors} ->
          {:error, ApiError.validation("Missing fields. Failed to update user.", errors)}
      end
    end
  end

  @doc "DELETE /api/users/:id — delete one member, or 409 while they authored comments."
  def delete(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      case Users.remove(id) do
        :ok ->
          json(conn, %{"ok" => true, "message" => "User deleted.", "redirectTo" => "/users"})

        :missing ->
          {:error, ApiError.not_found("That user no longer exists.")}

        {:error, {:restricted, message}} ->
          {:error, ApiError.conflict(message)}
      end
    end
  end
end
