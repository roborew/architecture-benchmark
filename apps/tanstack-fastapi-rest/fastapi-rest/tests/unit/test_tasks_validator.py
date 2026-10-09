"""tests/unit/test_tasks_validator.py

The tasks validator's pure contract: the list query params, and the write
bodies. The message strings are pinned verbatim against the reference
variant's actions.ts (TaskSchema / CommentSchema — the zod schemas) — a drift
here is a client-visible change to the API's error contract. No database, no
FastAPI.
"""

from __future__ import annotations

from app.tasks.validator import (
    CommentBodyFields,
    ProjectTaskFilters,
    TaskFields,
    TaskListFilters,
    TaskRefs,
    WithCommentFields,
    parse_comment_body,
    parse_create_task_refs,
    parse_project_task_list_query,
    parse_task_fields,
    parse_task_list_query,
    parse_task_status,
    parse_update_assignee,
    parse_with_comment_fields,
)


class TestParseTaskStatus:
    def test_accepts_each_stored_status_value_and_treats_absent_empty_as_no_filter(
        self,
    ) -> None:
        assert parse_task_status(None) == ("", None)
        assert parse_task_status("") == ("", None)
        assert parse_task_status(" todo ") == ("todo", None)
        assert parse_task_status("in progress") == ("in progress", None)
        assert parse_task_status("done") == ("done", None)

    def test_rejects_an_unknown_status_with_the_references_thrown_message(self) -> None:
        assert parse_task_status("bogus") == (None, "Unknown task status: bogus")

    def test_rejects_a_repeated_status_param(self) -> None:
        assert parse_task_status(["todo", "done"]) == (
            None,
            "status must be a single value",
        )


class TestParseTaskListQuery:
    def test_parses_every_filter_at_once(self) -> None:
        assert parse_task_list_query(
            {
                "q": "navigation",
                "status": "todo",
                "projectId": "1",
                "assigneeId": "2",
                "cursor": "abc",
                "limit": "10",
            }
        ) == (
            TaskListFilters(
                search="navigation",
                status="todo",
                project_id=1,
                assignee_id=2,
                cursor="abc",
                limit=10,
            ),
            None,
        )

    def test_treats_an_absent_everything_as_the_unfiltered_first_page(self) -> None:
        # The absent ids/cursor/limit default to None — the Express test's
        # `{search: "", status: "", cursor: null}`.
        assert parse_task_list_query({}) == (
            TaskListFilters(search="", status=""),
            None,
        )

    def test_keeps_the_references_q_envelopes_for_malformed_q(self) -> None:
        assert parse_task_list_query({"q": ["a", "b"]}) == (
            None,
            "q must be a single value",
        )
        assert parse_task_list_query({"q": "a" * 101}) == (
            None,
            "q must be at most 100 characters",
        )

    def test_rejects_non_integer_filter_ids(self) -> None:
        assert parse_task_list_query({"projectId": "one"}) == (
            None,
            "projectId must be an integer",
        )
        assert parse_task_list_query({"assigneeId": "1.5"}) == (
            None,
            "assigneeId must be an integer",
        )
        assert parse_task_list_query({"assigneeId": ["1", "2"]}) == (
            None,
            "assigneeId must be a single value",
        )

    def test_rejects_a_non_integer_or_repeated_limit(self) -> None:
        assert parse_task_list_query({"limit": "many"}) == (
            None,
            "limit must be an integer",
        )
        assert parse_task_list_query({"limit": ["1", "2"]}) == (
            None,
            "limit must be a single value",
        )


class TestParseProjectTaskListQuery:
    def test_parses_status_cursor_and_limit(self) -> None:
        assert parse_project_task_list_query(
            {"status": "todo", "cursor": "x", "limit": "2"}
        ) == (ProjectTaskFilters(status="todo", cursor="x", limit=2), None)

    def test_shares_the_workspace_lists_status_rejection(self) -> None:
        assert parse_project_task_list_query({"status": "nope"}) == (
            None,
            "Unknown task status: nope",
        )


class TestParseTaskFields:
    def test_accepts_the_task_fields_and_trims_title_and_description(self) -> None:
        assert parse_task_fields(
            {
                "title": "  Draft navigation model  ",
                "description": "  Map the structure  ",
                "status": "todo",
            }
        ) == (
            TaskFields(
                title="Draft navigation model",
                description="Map the structure",
                status="todo",
            ),
            None,
        )

    def test_treats_an_omitted_description_as_empty_like_an_unsubmitted_form_field(
        self,
    ) -> None:
        assert parse_task_fields({"title": "T", "status": "todo"}) == (
            TaskFields(title="T", description="", status="todo"),
            None,
        )

    def test_produces_the_references_field_messages_verbatim(self) -> None:
        assert parse_task_fields({"title": "", "status": "todo"}) == (
            None,
            {"title": ["Title is required."]},
        )

        assert parse_task_fields({"title": "a" * 201, "status": "todo"}) == (
            None,
            {"title": ["Title must be 200 characters or fewer."]},
        )

        assert parse_task_fields({"title": "T", "status": "bogus"}) == (
            None,
            {"status": ["Choose a valid status."]},
        )

    def test_reports_an_omitted_title_exactly_as_the_references_formdata_does(
        self,
    ) -> None:
        assert parse_task_fields({"status": "todo"}) == (
            None,
            {"title": ["Invalid input: expected string, received null"]},
        )


class TestParseCreateTaskRefs:
    def test_accepts_integer_ids_and_keeps_a_null_assignee_nullable(self) -> None:
        assert parse_create_task_refs({"projectId": 1, "assigneeId": 2}) == (
            TaskRefs(project_id=1, assignee_id=2),
            None,
        )
        assert parse_create_task_refs({"projectId": "1", "assigneeId": None}) == (
            TaskRefs(project_id=1, assignee_id=None),
            None,
        )
        assert parse_create_task_refs({"projectId": 1, "assigneeId": ""}) == (
            TaskRefs(project_id=1, assignee_id=None),
            None,
        )

    def test_produces_the_references_choose_a_project_choose_an_assignee_errors(
        self,
    ) -> None:
        assert parse_create_task_refs({"assigneeId": 1}) == (
            None,
            {"projectId": ["Choose a project."]},
        )
        assert parse_create_task_refs({"projectId": 1, "assigneeId": "x"}) == (
            None,
            {"assigneeId": ["Choose a valid assignee."]},
        )
        assert parse_create_task_refs({"projectId": 1.5, "assigneeId": 1.5}) == (
            None,
            {
                "projectId": ["Choose a project."],
                "assigneeId": ["Choose a valid assignee."],
            },
        )


class TestParseUpdateAssignee:
    def test_treats_absent_null_and_empty_as_unassigned(self) -> None:
        assert parse_update_assignee({}) == (None, None)
        assert parse_update_assignee({"assigneeId": None}) == (None, None)
        assert parse_update_assignee({"assigneeId": ""}) == (None, None)
        assert parse_update_assignee({"assigneeId": 3}) == (3, None)

    def test_rejects_a_non_integer_assignee(self) -> None:
        assert parse_update_assignee({"assigneeId": "nope"}) == (
            None,
            {"assigneeId": ["Choose a valid assignee."]},
        )


class TestParseWithCommentFields:
    def test_accepts_a_comment_body_and_author(self) -> None:
        assert parse_with_comment_fields(
            {"commentBody": " A note ", "commentAuthorId": 2}
        ) == (WithCommentFields(comment_body="A note", comment_author_id=2), None)

    def test_coerces_a_string_author_as_the_references_select_submits_it(self) -> None:
        assert parse_with_comment_fields(
            {"commentBody": "A note", "commentAuthorId": "2"}
        ) == (WithCommentFields(comment_body="A note", comment_author_id=2), None)

    def test_produces_the_references_comment_messages_verbatim(self) -> None:
        assert parse_with_comment_fields({"commentAuthorId": 2}) == (
            None,
            {"commentBody": ["Comment is required."]},
        )
        assert parse_with_comment_fields(
            {"commentBody": "a" * 1001, "commentAuthorId": 2}
        ) == (
            None,
            {"commentBody": ["Comment must be 1000 characters or fewer."]},
        )

    def test_reports_an_omitted_author_exactly_as_the_references_formdata_does(
        self,
    ) -> None:
        assert parse_with_comment_fields({"commentBody": "A note"}) == (
            None,
            {"commentAuthorId": ["Too small: expected number to be >0"]},
        )


class TestParseCommentBody:
    def test_accepts_a_body_and_author_keyed_by_this_endpoints_field_names(
        self,
    ) -> None:
        assert parse_comment_body({"body": " A note ", "authorId": 1}) == (
            CommentBodyFields(body="A note", author_id=1),
            None,
        )

    def test_carries_the_same_rule_strings_keyed_by_the_requests_fields(self) -> None:
        assert parse_comment_body({"authorId": 1}) == (
            None,
            {"body": ["Comment is required."]},
        )
        assert parse_comment_body({"body": "a" * 1001, "authorId": 1}) == (
            None,
            {"body": ["Comment must be 1000 characters or fewer."]},
        )
