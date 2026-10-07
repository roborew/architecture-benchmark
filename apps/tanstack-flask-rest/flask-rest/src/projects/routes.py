# src/projects/projects.routes.py
#
# The routing layer for projects: maps the REST surface onto controller calls.
# Registered by the app factory under /api/projects, so this file never sees
# the mount point and could be mounted anywhere without changes.
#
# This is the one layer that touches Flask: it reads the request (query
# values, JSON body, route params), hands plain values to the controller, and
# jsonifies the (status, payload) the controller decided on.

from flask import Blueprint, jsonify, request

from src.lib.body import request_body
from src.projects.controller import ProjectsController


def create_projects_blueprint(controller: ProjectsController) -> Blueprint:
    projects = Blueprint("projects", __name__)

    @projects.get("")
    def list_projects():
        status, payload = controller.list(request.args.getlist("q"))
        return jsonify(payload), status

    @projects.get("/<project_id>/tasks")
    def list_project_tasks(project_id: str):
        status, payload = controller.list_tasks(
            project_id, request.args.to_dict(flat=False)
        )
        return jsonify(payload), status

    # A plain string converter (not <int:>): an id that cannot name a row must
    # reach the controller, which answers the 400 envelope — an int converter
    # would turn it into a routing 404 instead.
    @projects.get("/<project_id>")
    def get_project(project_id: str):
        status, payload = controller.get(project_id)
        return jsonify(payload), status

    @projects.post("")
    def create_project():
        status, payload = controller.create(request_body(request))
        return jsonify(payload), status

    @projects.patch("/<project_id>")
    def update_project(project_id: str):
        status, payload = controller.update(project_id, request_body(request))
        return jsonify(payload), status

    @projects.delete("/<project_id>")
    def remove_project(project_id: str):
        status, payload = controller.remove(project_id)
        return jsonify(payload), status

    return projects
