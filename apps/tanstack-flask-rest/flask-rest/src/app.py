# src/app.py
#
# The app factory — the composition root.
#
# `create_app` builds the Flask application and wires the layers together
# (blueprints -> controllers -> models -> db). Tests drive it with the test
# client rather than binding a port; `src/server.py` is the only place that
# listens. The dependency is inverted: the server entry depends on the
# factory, never the reverse, so importing the app never opens a socket —
# which is also why the ``Db`` below connects lazily, not here.
#
# The Flask application-factory pattern (docs: patterns/appfactories) is what
# lets every test build its own app pointed at a database of its choosing.

from flask import Flask

from src.config.env import require_postgres_url
from src.dashboard.controller import DashboardController
from src.dashboard.model import PostgresDashboardModel
from src.dashboard.routes import create_dashboard_blueprint
from src.db.connection import Db
from src.health.routes import mount_health_routes
from src.middleware.cors import add_cors
from src.middleware.error_handler import register_error_handlers
from src.projects.controller import ProjectsController
from src.projects.model import PostgresProjectsModel
from src.projects.routes import create_projects_blueprint
from src.tasks.controller import TasksController
from src.tasks.model import PostgresTasksModel
from src.tasks.routes import create_tasks_blueprint
from src.users.controller import UsersController
from src.users.model import PostgresUsersModel
from src.users.routes import create_users_blueprint


def create_app(postgres_url: str | None = None) -> Flask:
    """Builds a wired, ready-to-serve application.

    ``postgres_url`` overrides the connection string the app's data layer
    uses: integration tests point this at their isolated database; production
    omits it and `src/config/env.py` supplies the value.
    """

    app = Flask(__name__)

    # Werkzeug would redirect /api/users -> /api/users/ (308) by default. The
    # express variant this API rebuilds serves both spellings (its routers
    # match the bare mount point), so both are matched here without a
    # redirect — the SPA fetches the bare path.
    app.url_map.strict_slashes = False

    # JSON keys in the order the SQL projection spells them — the express
    # variant's responses are insertion-ordered the same way (Flask's default
    # would sort them alphabetically).
    app.json.sort_keys = False

    # The dependency chain, composed here and nowhere else: connection ->
    # model -> controller -> blueprint. Each layer sees only the layer below
    # it, and every dependency is injected, so any layer can be swapped in a
    # test by constructing it with a fake of the layer below.
    db = Db(require_postgres_url(postgres_url))

    users_controller = UsersController(PostgresUsersModel(db))
    tasks_controller = TasksController(PostgresTasksModel(db))
    projects_controller = ProjectsController(PostgresProjectsModel(db))
    dashboard_controller = DashboardController(PostgresDashboardModel(db))

    mount_health_routes(app)
    # The blueprints are created blind (no url_prefix of their own) and
    # mounted here, exactly as the express variant's routers are — a domain's
    # routes file never sees its mount point.
    app.register_blueprint(
        create_users_blueprint(users_controller), url_prefix="/api/users"
    )
    app.register_blueprint(
        create_tasks_blueprint(tasks_controller), url_prefix="/api/tasks"
    )
    app.register_blueprint(
        create_projects_blueprint(projects_controller), url_prefix="/api/projects"
    )
    app.register_blueprint(
        create_dashboard_blueprint(dashboard_controller), url_prefix="/api/dashboard"
    )

    add_cors(app)
    # Registered after every blueprint, like the express variant's middleware
    # order: routes first, then the fall-through handlers.
    register_error_handlers(app)

    return app
