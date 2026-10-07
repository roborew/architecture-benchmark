# src/users/users.routes.py
#
# The routing layer for users: maps the REST surface onto controller calls.
# Registered by the app factory under /api/users, so this file never sees the
# mount point and could be mounted anywhere without changes.
#
# This is the one layer that touches Flask: it reads the request (query
# values, JSON body, route params), hands plain values to the controller, and
# jsonifies the (status, payload) the controller decided on.

from flask import Blueprint, jsonify, request

from src.lib.body import request_body
from src.users.controller import UsersController


def create_users_blueprint(controller: UsersController) -> Blueprint:
    users = Blueprint("users", __name__)

    @users.get("")
    def list_users():
        status, payload = controller.list(request.args.getlist("q"))
        return jsonify(payload), status

    @users.get("/<user_id>/tasks")
    def list_user_tasks(user_id: str):
        status, payload = controller.list_tasks(user_id)
        return jsonify(payload), status

    # A plain string converter (not <int:>): an id that cannot name a row must
    # reach the controller, which answers the 400 envelope — an int converter
    # would turn it into a routing 404 instead.
    @users.get("/<user_id>")
    def get_user(user_id: str):
        status, payload = controller.get(user_id)
        return jsonify(payload), status

    @users.post("")
    def create_user():
        status, payload = controller.create(request_body(request))
        return jsonify(payload), status

    @users.patch("/<user_id>")
    def update_user(user_id: str):
        status, payload = controller.update(user_id, request_body(request))
        return jsonify(payload), status

    @users.delete("/<user_id>")
    def remove_user(user_id: str):
        status, payload = controller.remove(user_id)
        return jsonify(payload), status

    return users
