# src/dashboard/dashboard.model.py
#
# The model layer for the dashboard: the only place that knows the dashboard
# SQL. Mirrors the reference variant (apps/tanstack-start-react/src/lib/
# data.ts — getDashboardStats, getRecentTasks, getDashboardProjects)
# statement for statement, so both apps return identical rows for the same
# database.
#
# The dashboard's task rows use their own slimmer projection rather than the
# shared task projection (src/lib/task_projection.py): the recent-tasks table
# shows no description, project id or comment count, and pulling columns the
# card never renders would cost the join for nothing.

import logging
from typing import Protocol, TypedDict

import psycopg2
from psycopg2.sql import SQL

from src.db.connection import Db

logger = logging.getLogger(__name__)

#: How many rows each dashboard section shows.
DASHBOARD_RECENT_TASKS = 3
DASHBOARD_PROJECTS = 2


class DashboardStats(TypedDict):
    projectCount: int
    totalTasks: int
    openTasks: int
    peopleCount: int
    todoTasks: int
    inProgressTasks: int
    doneTasks: int


class DashboardTask(TypedDict):
    """The recent-tasks table's row: a task without project id, description
    or comment count."""

    id: int
    title: str
    projectName: str
    status: str
    assigneeName: str
    updatedAt: str


class DashboardProject(TypedDict):
    """The dashboard card's project: the listing row without the creation
    date."""

    id: int
    name: str
    description: str
    taskCount: int
    openTaskCount: int
    peopleCount: int


class DashboardModel(Protocol):
    """The dashboard surface, as the controller sees it: SQL in, plain rows
    out."""

    def stats(self) -> DashboardStats:
        """Workspace totals for the stat cards."""
        ...

    def recent_tasks(self) -> list[DashboardTask]:
        """The most recently updated tasks, for the recent table. Ordered by
        updated_at rather than created_at: "recent activity" means when the
        work last moved, which is also what updateTask advances."""
        ...

    def projects(self) -> list[DashboardProject]:
        """The busiest projects, for the project cards. Ordered by task count
        so the cards answer "where is the work?" rather than repeating the
        newest-first ordering of every other list."""
        ...


class PostgresDashboardModel:
    """The dashboard SQL against the composed ``Db``."""

    def __init__(self, db: Db) -> None:
        self._db = db

    def stats(self) -> DashboardStats:
        try:
            # One statement rather than three, because the cards are rendered
            # together and separate COUNT queries would each scan a different
            # table for the same row.
            rows = self._db.query(
                SQL(
                    """
                    SELECT
                      (SELECT COUNT(*) FROM projects)::int AS "projectCount",
                      (SELECT COUNT(*) FROM tasks)::int AS "totalTasks",
                      (
                        SELECT COUNT(*) FROM tasks WHERE status <> 'done'
                      )::int AS "openTasks",
                      (SELECT COUNT(*) FROM users)::int AS "peopleCount",
                      (SELECT COUNT(*) FROM tasks WHERE status = 'todo')::int AS "todoTasks",
                      (
                        SELECT COUNT(*) FROM tasks WHERE status = 'in progress'
                      )::int AS "inProgressTasks",
                      (SELECT COUNT(*) FROM tasks WHERE status = 'done')::int AS "doneTasks"
                    """
                )
            )
            return rows[0]
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the dashboard stats.") from error

    def recent_tasks(self) -> list[DashboardTask]:
        try:
            return self._db.query(
                SQL(
                    """
                    SELECT
                      t.id::int AS id,
                      t.title,
                      p.name AS "projectName",
                      t.status,
                      COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
                      to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
                    FROM tasks t
                    JOIN projects p ON p.id = t.project_id
                    LEFT JOIN users u ON u.id = t.assignee_id
                    ORDER BY t.updated_at DESC, t.id DESC
                    LIMIT %(limit)s
                    """
                ),
                {"limit": DASHBOARD_RECENT_TASKS},
            )
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch recent tasks.") from error

    def projects(self) -> list[DashboardProject]:
        try:
            return self._db.query(
                SQL(
                    """
                    SELECT
                      p.id::int AS id,
                      p.name,
                      p.description,
                      COUNT(t.id)::int AS "taskCount",
                      COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
                      COUNT(DISTINCT t.assignee_id)::int AS "peopleCount"
                    FROM projects p
                    LEFT JOIN tasks t ON p.id = t.project_id
                    GROUP BY p.id, p.name, p.description
                    ORDER BY COUNT(t.id) DESC, p.id ASC
                    LIMIT %(limit)s
                    """
                ),
                {"limit": DASHBOARD_PROJECTS},
            )
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch dashboard projects.") from error
