defmodule PhoenixRestWeb.Router do
  use PhoenixRestWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {PhoenixRestWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", PhoenixRestWeb do
    pipe_through :api

    # The readiness endpoint the rig and every e2e webServer waits on — before
    # the database exists, so it never touches the Repo (HealthController).
    get "/healthz", HealthController, :show
  end

  scope "/api", PhoenixRestWeb do
    pipe_through :api

    # `/:id/tasks` is listed before `/:id` so the more specific path wins.
    get "/users", UserController, :index
    get "/users/:id/tasks", UserController, :tasks
    get "/users/:id", UserController, :show
    post "/users", UserController, :create
    patch "/users/:id", UserController, :update
    delete "/users/:id", UserController, :delete

    get "/projects", ProjectController, :index
    get "/projects/:id/tasks", ProjectController, :tasks
    get "/projects/:id", ProjectController, :show
    post "/projects", ProjectController, :create
    patch "/projects/:id", ProjectController, :update
    delete "/projects/:id", ProjectController, :delete

    # `count` is listed before `/:id`, so it is not captured as a task id.
    get "/tasks", TaskController, :index
    get "/tasks/count", TaskController, :count
    get "/tasks/:id/comments", TaskController, :comments
    get "/tasks/:id", TaskController, :show
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:phoenix_rest, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: PhoenixRestWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
