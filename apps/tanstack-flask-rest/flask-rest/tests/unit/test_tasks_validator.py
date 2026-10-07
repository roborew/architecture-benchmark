# tests/unit/test_tasks_validator.py
#
# The tasks validator's pure contract: the list query params, and the write
# bodies. The message strings are pinned verbatim against the reference
# variant's actions.ts (TaskSchema / CommentSchema) — a drift here is a
# client-visible change to the API's error contract. No database, no Flask.

import pytest

from src.lib.query_validator import QueryParamError
from src.tasks.validator import (
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
    def test_accepts_each_stored_status_and_treats_absent_empty_as_no_filter(self):
        assert parse_task_status([]) == ""
        assert parse_task_status([""]) == ""
        assert parse_task_status([" todo "]) == "todo"
        assert parse_task_status(["in progress"]) == "in progress"
        assert parse_task_status(["done"]) == "done"

    def test_rejects_an_unknown_status_with_the_reference_message(self):
        with pytest.raises(QueryParamError) as raised:
            parse_task_status(["bogus"])

        assert str(raised.value) == "Unknown task status: bogus"

    def test_rejects_a_repeated_status_param(self):
        with pytest.raises(QueryParamError) as raised:
            parse_task_status(["todo", "done"])

        assert str(raised.value) == "status must be a single value"


class TestParseTaskListQuery:
    def test_parses_every_filter_at_once(self):
        filters = parse_task_list_query(
            {
                "q": ["navigation"],
                "status": ["todo"],
                "projectId": ["1"],
                "assigneeId": ["2"],
                "cursor": ["abc"],
                "limit": ["10"],
            }
        )

        assert filters.search == "navigation"
        assert filters.status == "todo"
        assert filters.project_id == 1
        assert filters.assignee_id == 2
        assert filters.cursor == "abc"
        assert filters.limit == 10

    def test_treats_an_absent_everything_as_the_unfiltered_first_page(self):
        filters = parse_task_list_query({})

        assert filters.search == ""
        assert filters.status == ""
        assert filters.project_id is None
        assert filters.assignee_id is None
        assert filters.cursor is None
        assert filters.limit is None

    def test_keeps_the_reference_q_envelopes_for_malformed_q(self):
        with pytest.raises(QueryParamError) as raised:
            parse_task_list_query({"q": ["a", "b"]})
        assert str(raised.value) == "q must be a single value"

        with pytest.raises(QueryParamError) as raised:
            parse_task_list_query({"q": ["a" * 101]})
        assert str(raised.value) == "q must be at most 100 characters"

    def test_rejects_non_integer_filter_ids(self):
        with pytest.raises(QueryParamError) as raised:
            parse_task_list_query({"projectId": ["one"]})
        assert str(raised.value) == "projectId must be an integer"

        with pytest.raises(QueryParamError) as raised:
            parse_task_list_query({"assigneeId": ["1.5"]})
        assert str(raised.value) == "assigneeId must be an integer"

        with pytest.raises(QueryParamError) as raised:
            parse_task_list_query({"assigneeId": ["1", "2"]})
        assert str(raised.value) == "assigneeId must be a single value"

    def test_rejects_a_non_integer_or_repeated_limit(self):
        with pytest.raises(QueryParamError) as raised:
            parse_task_list_query({"limit": ["many"]})
        assert str(raised.value) == "limit must be an integer"

        with pytest.raises(QueryParamError) as raised:
            parse_task_list_query({"limit": ["1", "2"]})
        assert str(raised.value) == "limit must be a single value"


class TestParseProjectTaskListQuery:
    def test_parses_status_cursor_and_limit(self):
        filters = parse_project_task_list_query(
            {"status": ["todo"], "cursor": ["x"], "limit": ["2"]}
        )

        assert filters.status == "todo"
        assert filters.cursor == "x"
        assert filters.limit == 2

    def test_shares_the_workspace_lists_status_rejection(self):
        with pytest.raises(QueryParamError) as raised:
            parse_project_task_list_query({"status": ["nope"]})

        assert str(raised.value) == "Unknown task status: nope"


class TestParseTaskFields:
    def test_accepts_the_task_fields_and_trims_title_and_description(self):
        parsed = parse_task_fields(
            {
                "title": "  Draft navigation model  ",
                "description": "  Map the structure  ",
                "status": "todo",
            }
        )

        assert parsed is not None
        assert parsed.title == "Draft navigation model"
        assert parsed.description == "Map the structure"
        assert parsed.status == "todo"

    def test_treats_an_omitted_description_as_empty_like_an_unsubmitted_field(self):
        parsed = parse_task_fields({"title": "T", "status": "todo"})

        assert parsed is not None
        assert parsed.description == ""

    def test_produces_the_reference_field_messages_verbatim(self):
        parsed = parse_task_fields({"title": "", "status": "todo"})
        assert parsed.errors == {"title": ["Title is required."]}

        parsed = parse_task_fields({"title": "a" * 201, "status": "todo"})
        assert parsed.errors == {"title": ["Title must be 200 characters or fewer."]}

        parsed = parse_task_fields({"title": "T", "status": "bogus"})
        assert parsed.errors == {"status": ["Choose a valid status."]}

    def test_reports_an_omitted_title_exactly_as_the_reference_formdata_does(self):
        parsed = parse_task_fields({"status": "todo"})

        assert parsed.errors == {
            "title": ["Invalid input: expected string, received null"]
        }


class TestParseCreateTaskRefs:
    def test_accepts_integer_ids_and_keeps_a_null_assignee_nullable(self):
        assert parse_create_task_refs({"projectId": 1, "assigneeId": 2}) == (1, 2)
        assert parse_create_task_refs({"projectId": "1", "assigneeId": None}) == (
            1,
            None,
        )
        assert parse_create_task_refs({"projectId": 1, "assigneeId": ""}) == (1, None)

    def test_produces_the_reference_choose_errors(self):
        parsed = parse_create_task_refs({"assigneeId": 1})
        assert parsed.errors == {"projectId": ["Choose a project."]}

        parsed = parse_create_task_refs({"projectId": 1, "assigneeId": "x"})
        assert parsed.errors == {"assigneeId": ["Choose a valid assignee."]}

        parsed = parse_create_task_refs({"projectId": 1.5, "assigneeId": 1.5})
        assert parsed.errors == {
            "projectId": ["Choose a project."],
            "assigneeId": ["Choose a valid assignee."],
        }


class TestParseUpdateAssignee:
    def test_treats_absent_null_and_empty_as_unassigned(self):
        assert parse_update_assignee({}) is None
        assert parse_update_assignee({"assigneeId": None}) is None
        assert parse_update_assignee({"assigneeId": ""}) is None
        assert parse_update_assignee({"assigneeId": 3}) == 3

    def test_rejects_a_non_integer_assignee(self):
        parsed = parse_update_assignee({"assigneeId": "nope"})

        assert parsed.errors == {"assigneeId": ["Choose a valid assignee."]}


class TestParseWithCommentFields:
    def test_accepts_a_comment_body_and_author(self):
        parsed = parse_with_comment_fields(
            {"commentBody": " A note ", "commentAuthorId": 2}
        )

        assert parsed is not None
        assert parsed.comment_body == "A note"
        assert parsed.comment_author_id == 2

    def test_coerces_a_string_author_as_the_reference_select_submits_it(self):
        parsed = parse_with_comment_fields(
            {"commentBody": "A note", "commentAuthorId": "2"}
        )

        assert parsed.comment_author_id == 2

    def test_produces_the_reference_comment_messages_verbatim(self):
        parsed = parse_with_comment_fields({"commentAuthorId": 2})
        assert parsed.errors == {"commentBody": ["Comment is required."]}

        parsed = parse_with_comment_fields(
            {"commentBody": "a" * 1001, "commentAuthorId": 2}
        )
        assert parsed.errors == {
            "commentBody": ["Comment must be 1000 characters or fewer."]
        }

    def test_reports_an_omitted_author_exactly_as_the_reference_formdata_does(self):
        # z.coerce.number() runs JS Number() first: Number(null) is 0, which
        # then fails the positive check with zod's own "Too small" line.
        parsed = parse_with_comment_fields({"commentBody": "A note"})

        assert parsed.errors == {
            "commentAuthorId": ["Too small: expected number to be >0"]
        }


class TestParseCommentBody:
    def test_accepts_a_body_and_author_keyed_by_this_endpoints_fields(self):
        parsed = parse_comment_body({"body": " A note ", "authorId": 1})

        assert parsed is not None
        assert parsed.body == "A note"
        assert parsed.author_id == 1

    def test_carries_the_same_rule_strings_keyed_by_the_requests_fields(self):
        parsed = parse_comment_body({"authorId": 1})
        assert parsed.errors == {"body": ["Comment is required."]}

        parsed = parse_comment_body({"body": "a" * 1001, "authorId": 1})
        assert parsed.errors == {"body": ["Comment must be 1000 characters or fewer."]}
