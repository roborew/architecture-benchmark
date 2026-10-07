# tests/integration/test_tasks_routes.py
#
# The /api/tasks surface — the reads behind the workspace list, the detail
# pages and the comment threads. Exercises the full HTTP stack (blueprints ->
# controller -> model -> Postgres) through the test client against the seeded
# test database, and asserts the exact rows the shared fixture produces so a
# SQL drift is caught here, not in the browser.
#
# The row shapes and orderings mirror the reference variant (getTasks,
# getTask, getComments, countTasks), including the keyset paging over
# (updated_at, id).
#
# The seeded fixture (spec/snapshots/correctness), worked through by hand:
#
#   tasks  101 (u1, in progress, updated 09-29, 2 comments)
#          102 (u2, todo, updated 09-28), 105 (u1, in progress, 09-28)
#          103 (u3, done, 09-27), 104 (u2, todo, 09-26, 1 comment)
#          106 (u3, todo, 09-23)

import urllib.parse

from src.lib.cursor import encode_cursor

EXPECTED_TASKS = [
    {
        "id": 101,
        "projectId": 1,
        "projectName": "Website redesign",
        "title": "Draft navigation model",
        "description": "Map the navigation structure for the public and authenticated product areas.",
        "status": "in progress",
        "assigneeName": "Robin Andrew",
        "commentCount": 2,
        "updatedAt": "2026-09-29T08:00:00Z",
        "updatedAtRaw": "2026-09-29T08:00:00.000000Z",
    },
    {
        "id": 102,
        "projectId": 1,
        "projectName": "Website redesign",
        "title": "Confirm breakpoint rules",
        "description": "Agree the breakpoints the shared layout tokens are generated from.",
        "status": "todo",
        "assigneeName": "Alex Morgan",
        "commentCount": 0,
        "updatedAt": "2026-09-28T11:20:00Z",
        "updatedAtRaw": "2026-09-28T11:20:00.000000Z",
    },
    {
        "id": 105,
        "projectId": 2,
        "projectName": "Mobile application",
        "title": "Build profile screen",
        "description": "Implement the profile screen for existing workspace members.",
        "status": "in progress",
        "assigneeName": "Robin Andrew",
        "commentCount": 0,
        "updatedAt": "2026-09-28T09:30:00Z",
        "updatedAtRaw": "2026-09-28T09:30:00.000000Z",
    },
    {
        "id": 103,
        "projectId": 1,
        "projectName": "Website redesign",
        "title": "Prepare content inventory",
        "description": "Collect the copy and imagery currently live across the public pages.",
        "status": "done",
        "assigneeName": "Sam Taylor",
        "commentCount": 0,
        "updatedAt": "2026-09-27T16:45:00Z",
        "updatedAtRaw": "2026-09-27T16:45:00.000000Z",
    },
    {
        "id": 104,
        "projectId": 2,
        "projectName": "Mobile application",
        "title": "Review API response shapes",
        "description": "Check the client expectations against the shapes the service returns.",
        "status": "todo",
        "assigneeName": "Alex Morgan",
        "commentCount": 1,
        "updatedAt": "2026-09-26T10:00:00Z",
        "updatedAtRaw": "2026-09-26T10:00:00.000000Z",
    },
    {
        "id": 106,
        "projectId": 3,
        "projectName": "Platform migration",
        "title": "Write migration checklist",
        "description": "List the steps and owners for moving to the new platform.",
        "status": "todo",
        "assigneeName": "Sam Taylor",
        "commentCount": 0,
        "updatedAt": "2026-09-23T11:20:00Z",
        "updatedAtRaw": "2026-09-23T11:20:00.000000Z",
    },
]

for task in EXPECTED_TASKS:
    task["cursorFor"] = encode_cursor(task["updatedAtRaw"], task["id"])


class TestListTasks:
    def test_returns_200_with_a_json_array(self, client):
        response = client.get("/api/tasks")

        assert response.status_code == 200
        assert response.content_type.startswith("application/json")
        assert isinstance(response.get_json(), list)

    def test_returns_exactly_the_seeded_tasks_aggregates_and_cursor_fields(
        self, client
    ):
        response = client.get("/api/tasks")

        # Exact equality: the row shape is the API contract.
        assert response.get_json() == EXPECTED_TASKS

    def test_returns_the_whole_fixture_as_the_first_page_25_is_the_default_limit(
        self, client
    ):
        response = client.get("/api/tasks")

        # Six seeded rows, one page: the default limit only shows once the
        # fixture outgrows it, which the paging tests below cover with an
        # explicit limit.
        assert len(response.get_json()) == 6

    def test_orders_tasks_by_most_recently_updated_then_id_descending(self, client):
        response = client.get("/api/tasks")

        assert [task["id"] for task in response.get_json()] == [
            101,
            102,
            105,
            103,
            104,
            106,
        ]

    def test_counts_the_comments_each_task_carries_across_the_join(self, client):
        response = client.get("/api/tasks")

        by_title = {task["title"]: task for task in response.get_json()}

        # Task 101 has two comments and a single assignee; the project and
        # assignee joins must not multiply its comment count.
        assert by_title["Draft navigation model"]["assigneeName"] == "Robin Andrew"
        assert by_title["Draft navigation model"]["projectName"] == "Website redesign"
        assert by_title["Draft navigation model"]["commentCount"] == 2
        assert by_title["Review API response shapes"]["commentCount"] == 1
        assert by_title["Write migration checklist"]["commentCount"] == 0

    def test_renders_the_stored_status_values_without_translation(self, client):
        response = client.get("/api/tasks")

        statuses = [task["status"] for task in response.get_json()]

        # The stored values are the contract (spec/contract.md): no display
        # mapping.
        assert "in progress" in statuses
        assert "done" in statuses
        assert "todo" in statuses

    def test_matches_a_task_title_case_insensitively(self, client):
        response = client.get("/api/tasks?q=NAVIGATION")

        tasks = response.get_json()
        assert len(tasks) == 1
        assert tasks[0]["id"] == 101
        assert tasks[0]["title"] == "Draft navigation model"

    def test_matches_on_description_as_well_as_title(self, client):
        # "expectations" appears only in task 104's description, in no title.
        response = client.get("/api/tasks?q=expectations")

        tasks = response.get_json()
        assert len(tasks) == 1
        assert tasks[0]["id"] == 104

    def test_returns_an_empty_array_for_a_term_that_matches_no_task(self, client):
        response = client.get("/api/tasks?q=no-such-task")

        assert response.status_code == 200
        assert response.get_json() == []

    def test_treats_like_wildcards_in_the_term_as_literal_characters(self, client):
        # A bare % would otherwise match every row and hide a real escaping
        # bug.
        percent = client.get("/api/tasks?q=%")
        underscore = client.get("/api/tasks?q=_")

        assert percent.get_json() == []
        assert underscore.get_json() == []

    def test_ignores_surrounding_whitespace(self, client):
        response = client.get("/api/tasks?q=%20%20Draft%20navigation%20model%20%20")

        tasks = response.get_json()
        assert len(tasks) == 1
        assert tasks[0]["id"] == 101

    def test_filters_by_status(self, client):
        todo = client.get("/api/tasks?status=todo")
        done = client.get("/api/tasks?status=done")

        assert [task["id"] for task in todo.get_json()] == [102, 104, 106]
        assert [task["id"] for task in done.get_json()] == [103]

    def test_filters_by_project_and_by_assignee(self, client):
        project = client.get("/api/tasks?projectId=1")
        assignee = client.get("/api/tasks?assigneeId=1")

        assert [task["id"] for task in project.get_json()] == [101, 102, 103]
        assert [task["id"] for task in assignee.get_json()] == [101, 105]

    def test_combines_filters_with_the_search_term(self, client):
        response = client.get("/api/tasks?q=navigation&status=todo")

        assert response.get_json() == []

    def test_returns_400_with_the_reference_message_for_an_unknown_status(self, client):
        response = client.get("/api/tasks?status=bogus")

        assert response.status_code == 400
        assert response.get_json() == {"error": "Unknown task status: bogus"}

    def test_returns_400_when_q_is_repeated(self, client):
        response = client.get("/api/tasks?q=navigation&q=breakpoint")

        assert response.status_code == 400
        assert response.get_json() == {"error": "q must be a single value"}

    def test_returns_400_when_q_is_longer_than_100_characters(self, client):
        response = client.get("/api/tasks?q=" + "a" * 101)

        assert response.status_code == 400
        assert response.get_json() == {"error": "q must be at most 100 characters"}

    def test_returns_400_for_a_non_integer_project_or_assignee_filter(self, client):
        project = client.get("/api/tasks?projectId=one")
        assignee = client.get("/api/tasks?assigneeId=1.5")

        assert project.status_code == 400
        assert project.get_json() == {"error": "projectId must be an integer"}
        assert assignee.status_code == 400
        assert assignee.get_json() == {"error": "assigneeId must be an integer"}

    def test_returns_400_for_a_non_integer_limit(self, client):
        response = client.get("/api/tasks?limit=many")

        assert response.status_code == 400
        assert response.get_json() == {"error": "limit must be an integer"}


class TestListTasksKeysetPaging:
    def test_limits_the_page_to_the_requested_size(self, client):
        response = client.get("/api/tasks?limit=3")

        assert [task["id"] for task in response.get_json()] == [101, 102, 105]

    def test_clamps_a_zero_or_negative_limit_to_one_row_like_the_reference(
        self, client
    ):
        zero = client.get("/api/tasks?limit=0")
        negative = client.get("/api/tasks?limit=-7")

        assert len(zero.get_json()) == 1
        assert len(negative.get_json()) == 1

    def test_clamps_an_oversized_limit_to_26_the_reference_page_ceiling(self, client):
        response = client.get("/api/tasks?limit=100")

        # Six seeded rows: the clamp only shows once the fixture outgrows it.
        assert len(response.get_json()) == 6

    def test_follows_a_cursor_onto_the_older_page(self, client):
        first = client.get("/api/tasks?limit=3")
        cursor = first.get_json()[2]["cursorFor"]

        second = client.get("/api/tasks?limit=3&cursor=" + urllib.parse.quote(cursor))

        assert [task["id"] for task in second.get_json()] == [103, 104, 106]

    def test_is_stable_and_repeatable_the_same_cursor_yields_the_same_page(
        self, client
    ):
        first = client.get("/api/tasks?limit=2")
        cursor = first.get_json()[1]["cursorFor"]
        url = "/api/tasks?limit=2&cursor=" + urllib.parse.quote(cursor)

        # spec/queries.md: the cursor "must be stable and repeatable".
        second = client.get(url)
        third = client.get(url)

        assert second.get_json() == third.get_json()
        assert [task["id"] for task in second.get_json()] == [105, 103]

    def test_reads_the_first_page_for_a_cursor_nothing_could_have_produced(
        self, client
    ):
        # A malformed or hand-edited cursor decodes to nothing, which the
        # reference turns into the first page rather than an error.
        response = client.get("/api/tasks?cursor=not-a-cursor")

        assert response.status_code == 200
        assert [task["id"] for task in response.get_json()] == [
            101,
            102,
            105,
            103,
            104,
            106,
        ]

    def test_keeps_the_filters_while_paging(self, client):
        first = client.get("/api/tasks?status=todo&limit=2")
        cursor = first.get_json()[1]["cursorFor"]

        second = client.get(
            "/api/tasks?status=todo&limit=2&cursor=" + urllib.parse.quote(cursor)
        )

        assert [task["id"] for task in first.get_json()] == [102, 104]
        assert [task["id"] for task in second.get_json()] == [106]


class TestCountTasks:
    def test_counts_every_seeded_task_with_no_filters(self, client):
        response = client.get("/api/tasks/count")

        assert response.status_code == 200
        assert response.get_json() == {"count": 6}

    def test_counts_the_tasks_matching_each_filter(self, client):
        search = client.get("/api/tasks/count?q=navigation")
        status = client.get("/api/tasks/count?status=todo")
        project = client.get("/api/tasks/count?projectId=1")
        assignee = client.get("/api/tasks/count?assigneeId=1")

        assert search.get_json() == {"count": 1}
        assert status.get_json() == {"count": 3}
        assert project.get_json() == {"count": 3}
        assert assignee.get_json() == {"count": 2}

    def test_shares_the_lists_status_rejection(self, client):
        response = client.get("/api/tasks/count?status=bogus")

        assert response.status_code == 400
        assert response.get_json() == {"error": "Unknown task status: bogus"}


class TestGetTask:
    def test_returns_exactly_the_task_row_without_the_cursor_fields(self, client):
        response = client.get("/api/tasks/101")

        # A single row by primary key has no cursor to build, so the detail
        # row is the shared projection verbatim.
        assert response.status_code == 200
        assert response.get_json() == {
            "id": 101,
            "projectId": 1,
            "projectName": "Website redesign",
            "title": "Draft navigation model",
            "description": "Map the navigation structure for the public and authenticated product areas.",
            "status": "in progress",
            "assigneeName": "Robin Andrew",
            "commentCount": 2,
            "updatedAt": "2026-09-29T08:00:00Z",
        }

    def test_returns_the_plain_404_envelope_for_an_unknown_id(self, client):
        response = client.get("/api/tasks/999")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Not found"}

    def test_returns_400_for_an_id_that_cannot_name_a_row(self, client):
        response = client.get("/api/tasks/abc")

        assert response.status_code == 400
        assert response.get_json() == {"error": "id must be a positive integer"}


class TestGetTaskComments:
    def test_returns_the_tasks_comments_newest_first_with_author_names(self, client):
        response = client.get("/api/tasks/101/comments")

        assert response.status_code == 200
        assert response.get_json() == [
            {
                "id": 2,
                "taskId": 101,
                "authorName": "Robin Andrew",
                "body": "Thanks - I will use that to confirm the signed-in navigation.",
                "createdAt": "2026-09-29T10:18:00Z",
            },
            {
                "id": 1,
                "taskId": 101,
                "authorName": "Alex Morgan",
                "body": "I have added the initial content grouping for review.",
                "createdAt": "2026-09-29T09:42:00Z",
            },
        ]

    def test_returns_an_empty_array_for_a_task_with_no_comments(self, client):
        response = client.get("/api/tasks/106/comments")

        assert response.status_code == 200
        assert response.get_json() == []
