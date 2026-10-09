defmodule PhoenixRestWeb.ProjectController do
  # The controller layer for projects: validates the request, translates it into
  # a context call, and writes the result to the response. Ported from the
  # reference variant's projects.controller.ts.
  #
  # Validation lives in PhoenixRest.Projects.Validator (bodies),
  # PhoenixRest.QueryParams (q / :id), and the tasks domain's pure validator for
  # the board's params — the board's rows are task rows.
  @moduledoc false

  use PhoenixRestWeb, :controller

  alias PhoenixRest.{Projects, QueryParams}
  alias PhoenixRest.Projects.Validator
  alias PhoenixRest.Tasks.Validator, as: TasksValidator
  alias PhoenixRestWeb.{ApiError, Params}

  action_fallback PhoenixRestWeb.FallbackController

  @doc "GET /api/projects — every project with its aggregate counts."
  def index(conn, _params) do
    case conn |> Params.search_term() |> QueryParams.parse_search_term() do
      {:ok, term} -> json(conn, Projects.list(term))
      {:error, message} -> {:error, ApiError.bad_request(message)}
    end
  end

  @doc "GET /api/projects/:id — one project with the same shape `list` returns."
  def show(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw),
         %{} = project <- Projects.get(id) do
      json(conn, project)
    else
      {:error, error} -> {:error, error}
      nil -> {:error, ApiError.not_found("Not found")}
    end
  end

  @doc "GET /api/projects/:id/tasks — one keyset page of a project's board."
  def tasks(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      case conn |> Params.query() |> TasksValidator.parse_project_list_query() do
        {:ok, filters} -> json(conn, Projects.list_tasks(id, filters))
        {:error, message} -> {:error, ApiError.bad_request(message)}
      end
    end
  end

  @doc "POST /api/projects — insert one project, redirect to its board."
  def create(conn, _params) do
    case Validator.parse_body(conn.body_params) do
      {:ok, data} ->
        {:ok, %{id: id}} = Projects.create(data)

        conn
        |> put_status(201)
        |> json(%{
          "ok" => true,
          "message" => "Project created.",
          "redirectTo" => "/projects/#{id}"
        })

      {:error, errors} ->
        {:error, ApiError.validation("Missing fields. Failed to create project.", errors)}
    end
  end

  @doc "PATCH /api/projects/:id — update one project by primary key."
  def update(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      case Validator.parse_body(conn.body_params) do
        {:ok, data} ->
          case Projects.update(id, data) do
            :ok ->
              json(conn, %{
                "ok" => true,
                "message" => "Project updated.",
                "redirectTo" => "/projects/#{id}"
              })

            :missing ->
              {:error, ApiError.not_found("That project no longer exists.")}
          end

        {:error, errors} ->
          {:error, ApiError.validation("Missing fields. Failed to update project.", errors)}
      end
    end
  end

  @doc "DELETE /api/projects/:id — delete one project, or 409 while it has tasks."
  def delete(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      case Projects.remove(id) do
        :ok ->
          json(conn, %{"ok" => true, "message" => "Project deleted.", "redirectTo" => "/projects"})

        :missing ->
          {:error, ApiError.not_found("That project no longer exists.")}

        {:error, {:restricted, message}} ->
          {:error, ApiError.conflict(message)}
      end
    end
  end
end
