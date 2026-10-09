# src/dashboard/dashboard.routes.py
#
# The routing layer for the dashboard: maps the REST surface onto controller
# calls. Registered by the app factory under /api/dashboard, so this file never
# sees the mount point and could be mounted anywhere without changes.

from flask import Blueprint, jsonify

from src.dashboard.controller import DashboardController


def create_dashboard_blueprint(controller: DashboardController) -> Blueprint:
    dashboard = Blueprint("dashboard", __name__)

    @dashboard.get("")
    def get_dashboard():
        status, payload = controller.get()
        return jsonify(payload), status

    return dashboard
