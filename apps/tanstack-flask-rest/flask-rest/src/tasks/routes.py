# src/tasks/tasks.routes.py
#
# The routing layer for tasks: maps the REST surface onto controller calls.
# Registered by the app factory under /api/tasks, so this file never sees the
# mount point and could be mounted anywhere without changes.
#
# This is the one layer that touches Flask: it reads the request (query
# values, JSON body, route params), hands plain values to the controller, and
# jsonifies the (status, payload) the controller decided on.
#
# Werkzeug routing prefers a static segment over a parameter, so `/count` and
# `/with-comment` win over `/<task_id>` regardless of registration order —
# where the express variant had to register its literals first.

from flask import Blueprint, jsonify, request

from src.lib.body import request_body
from src.tasks.controller import TasksController


def create_tasks_blueprint(controller: TasksController) -> Blueprint:
    tasks = Blueprint("tasks", __name__)

    @tasks.get("")
    def list_tasks():
        status, payload = controller.list(request.args.to_dict(flat=False))
        return jsonify(payload), status

    @tasks.get("/count")
    def count_tasks():
        status, payload = controller.count(request.args.to_dict(flat=False))
        return jsonify(payload), status

    @tasks.post("/with-comment")
    def create_task_with_comment():
        status, payload = controller.create_with_comment(request_body(request))
        return jsonify(payload), status

    @tasks.post("")
    def create_task():
        status, payload = controller.create(request_body(request))
        return jsonify(payload), status

    # A plain string converter (not <int:>): an id that cannot name a row must
    # reach the controller, which answers the 400 envelope — an int converter
    # would turn it into a routing 404 instead.
    @tasks.get("/<task_id>/comments")
    def list_task_comments(task_id: str):
        status, payload = controller.list_comments(task_id)
        return jsonify(payload), status

    @tasks.post("/<task_id>/comments")
    def add_task_comment(task_id: str):
        status, payload = controller.add_comment(task_id, request_body(request))
        return jsonify(payload), status

    @tasks.get("/<task_id>")
    def get_task(task_id: str):
        status, payload = controller.get(task_id)
        return jsonify(payload), status

    @tasks.patch("/<task_id>")
    def update_task(task_id: str):
        status, payload = controller.update(task_id, request_body(request))
        return jsonify(payload), status

    @tasks.delete("/<task_id>")
    def remove_task(task_id: str):
        status, payload = controller.remove(task_id)
        return jsonify(payload), status

    return tasks
