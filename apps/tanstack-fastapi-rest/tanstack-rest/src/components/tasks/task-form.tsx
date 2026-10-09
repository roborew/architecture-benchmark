// src/components/tasks/task-form.tsx
//
// One form for creating a task and for editing an existing one, plus a second
// form for the create-with-comment path.
//
// The two create forms exist separately because only the comment form is atomic
// (spec/queries.md: one transaction, task and comment or neither). Merging them
// would make every plain create pay for a comment field the user did not fill in.
//
// The validation state and the pending flags come from `useApiAction`, this
// app's stand-in for the reference variant's `useServerAction`: the form
// submits its FormData as a field bag, the action sends it to the REST API,
// and the hook renders the reply (or the ApiError's field errors) and
// navigates to the API's `redirectTo` on success.

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { createTask, createTaskWithComment, updateTask } from "@/api/tasks";
import { useApiAction } from "@/hooks/use-api-action";
import {
	cancelClass,
	createClass,
	inputClass,
	labelClass,
	selectClass,
	textareaClass,
} from "@/lib/form-styles";
import type { Project, Task, User } from "@/lib/types";

const STATUSES: { value: Task["status"]; label: string }[] = [
	{ value: "todo", label: "To do" },
	{ value: "in progress", label: "In progress" },
	{ value: "done", label: "Done" },
];

/**
 * Shared select fields.
 *
 * `idPrefix` keeps the `id`/`htmlFor` pairs unique: both forms render Project,
 * Assigned user and Status selects, and a duplicate `id` would make the label
 * bind to whichever came first in the document — leaving the second control
 * unnamed.
 */
function ProjectSelect({
	projects,
	defaultValue,
	invalid,
	idPrefix,
}: {
	projects: Project[];
	defaultValue: number;
	invalid?: boolean;
	idPrefix: string;
}) {
	return (
		<div>
			<label htmlFor={`${idPrefix}-project`} className={labelClass}>
				Project
			</label>
			<select
				id={`${idPrefix}-project`}
				name="projectId"
				defaultValue={String(defaultValue)}
				aria-invalid={invalid ? true : undefined}
				className={selectClass}
			>
				{projects.map((project) => (
					<option key={project.id} value={project.id}>
						{project.name}
					</option>
				))}
			</select>
		</div>
	);
}

function AssigneeSelect({
	people,
	defaultValue,
	invalid,
	idPrefix,
}: {
	people: User[];
	defaultValue: number | null;
	invalid?: boolean;
	idPrefix: string;
}) {
	return (
		<div>
			<label htmlFor={`${idPrefix}-assignee`} className={labelClass}>
				Assigned user
			</label>
			<select
				id={`${idPrefix}-assignee`}
				name="assigneeId"
				// An empty value is the explicit "unassigned" choice spec/contract.md
				// requires; it is never inferred from a missing field.
				defaultValue={defaultValue === null ? "" : String(defaultValue)}
				aria-invalid={invalid ? true : undefined}
				className={selectClass}
			>
				<option value="">Unassigned</option>
				{people.map((person) => (
					<option key={person.id} value={person.id}>
						{person.name}
					</option>
				))}
			</select>
		</div>
	);
}

function StatusSelect({
	defaultValue,
	invalid,
	idPrefix,
}: {
	defaultValue: Task["status"];
	invalid?: boolean;
	idPrefix: string;
}) {
	return (
		<div>
			<label htmlFor={`${idPrefix}-status`} className={labelClass}>
				Status
			</label>
			<select
				id={`${idPrefix}-status`}
				name="status"
				defaultValue={defaultValue}
				aria-invalid={invalid ? true : undefined}
				className={selectClass}
			>
				{STATUSES.map((status) => (
					<option key={status.value} value={status.value}>
						{status.label}
					</option>
				))}
			</select>
		</div>
	);
}

function FormMessage({ message }: { message?: string | null }) {
	if (!message) return null;

	return (
		<p
			role="alert"
			className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
		>
			{message}
		</p>
	);
}

/** The panel chrome both forms share, so only the fields differ between them. */
function Panel({ children }: { children: React.ReactNode }) {
	return (
		<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
			<div className="max-w-3xl p-5">{children}</div>
		</section>
	);
}

export function TaskForm({
	projects,
	people,
	task,
}: {
	projects: Project[];
	people: User[];
	task?: Task;
}) {
	const isEdit = task !== undefined;

	// The create/edit decision is made inside the callback: hooks cannot be
	// called conditionally, and the bound id rides the closure (`updateTask`
	// carries it in its URL), not a form field.
	const [state, formAction, pending] = useApiAction((values) =>
		isEdit ? updateTask(task.id, values) : createTask(values),
	);

	// Controlled rather than `defaultValue`: React resets an uncontrolled form
	// once the action it submitted to settles, so a rejected submit would blank
	// the fields the user just typed.
	const [title, setTitle] = useState(task?.title ?? "");
	const [description, setDescription] = useState(task?.description ?? "");

	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div className="mb-7">
				<p className="mb-2 text-[11px] font-medium text-slate-500">
					Tasks / {isEdit ? task.title : "New task"}
				</p>
				<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
					{isEdit ? "Edit task" : "New task"}
				</h1>
				<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
					{isEdit
						? "Update this task. Clearing the assignee leaves it unassigned."
						: "Select the project and user that this task belongs to."}
				</p>
			</div>

			<div className="grid gap-5">
				<Panel>
					<form
						action={formAction}
						data-testid={isEdit ? "update-task-form" : "create-task-form"}
					>
						<FormMessage message={state.message} />

						<label htmlFor="task-title" className={labelClass}>
							Title
						</label>
						<input
							id="task-title"
							name="title"
							required
							maxLength={200}
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="What needs to be done?"
							aria-invalid={state.errors?.title ? true : undefined}
							aria-describedby={
								state.errors?.title ? "task-title-error" : undefined
							}
							className={`${inputClass} mb-1`}
						/>
						{state.errors?.title ? (
							<p
								id="task-title-error"
								className="mb-3 text-[11px] font-semibold text-red-600"
							>
								{state.errors.title[0]}
							</p>
						) : (
							<div className="mb-3" />
						)}

						<label htmlFor="task-description" className={labelClass}>
							Description
						</label>
						<textarea
							id="task-description"
							name="description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Add context (optional)"
							className={`${textareaClass} mt-1.5 mb-0`}
						/>

						<div className="grid gap-4 sm:grid-cols-3">
							{/* On an edit the project is fixed: spec/contract.md lists the
							    update form's fields as title, status, assignee and
							    description only. */}
							{isEdit ? (
								<div>
									<span className={labelClass}>Project</span>
									<p className="text-[12px] text-slate-700">
										{projects.find((p) => p.id === task.projectId)?.name ??
											`Project ${task.projectId}`}
									</p>
								</div>
							) : (
								// No `task?.projectId` here: this branch only renders when there
								// is no task, so the optional chain would narrow to `never`.
								<ProjectSelect
									projects={projects}
									defaultValue={projects[0]?.id ?? 0}
									invalid={Boolean(state.errors?.projectId)}
									idPrefix="task"
								/>
							)}

							<AssigneeSelect
								people={people}
								defaultValue={null}
								invalid={Boolean(state.errors?.assigneeId)}
								idPrefix="task"
							/>

							<StatusSelect
								defaultValue={task?.status ?? "todo"}
								invalid={Boolean(state.errors?.status)}
								idPrefix="task"
							/>
						</div>

						{state.errors?.assigneeId ? (
							<p className="mt-2 text-[11px] font-semibold text-red-600">
								{state.errors.assigneeId[0]}
							</p>
						) : null}

						<div className="mt-5 flex items-center justify-end gap-2">
							{isEdit ? (
								<Link
									to="/tasks/$id"
									params={{ id: String(task.id) }}
									className={cancelClass}
								>
									Cancel
								</Link>
							) : (
								<Link to="/tasks" className={cancelClass}>
									Cancel
								</Link>
							)}
							<button type="submit" disabled={pending} className={createClass}>
								{pending
									? isEdit
										? "Saving…"
										: "Creating…"
									: isEdit
										? "Save changes"
										: "Create task"}
							</button>
						</div>
					</form>
				</Panel>

				{/* Create-with-comment is a create-only path: it is the one spec/queries.md
				    requires to be atomic, and an edit has no comment to create. */}
				{!isEdit ? (
					<CreateWithCommentForm projects={projects} people={people} />
				) : null}
			</div>
		</div>
	);
}

function CreateWithCommentForm({
	projects,
	people,
}: {
	projects: Project[];
	people: User[];
}) {
	const [state, formAction, pending] = useApiAction((values) =>
		createTaskWithComment(values),
	);

	return (
		<Panel>
			<form action={formAction} data-testid="create-with-comment-form">
				<h2 className="mb-1 text-[15px] font-bold tracking-[-.02em] text-slate-800">
					New task with a first comment
				</h2>
				<p className="mb-4 text-[12px] leading-6 text-slate-500">
					The task and its opening comment are written together, so either both
					exist or neither does.
				</p>

				<FormMessage message={state.message} />

				<label htmlFor="cwc-title" className={labelClass}>
					Title
				</label>
				<input
					id="cwc-title"
					name="title"
					required
					maxLength={200}
					aria-invalid={state.errors?.title ? true : undefined}
					placeholder="What needs to be done?"
					className={`${inputClass} mb-4`}
				/>
				{state.errors?.title ? (
					<p className="-mt-2 mb-3 text-[11px] font-semibold text-red-600">
						{state.errors.title[0]}
					</p>
				) : null}

				<label htmlFor="cwc-comment" className={labelClass}>
					First comment
				</label>
				<textarea
					id="cwc-comment"
					name="commentBody"
					required
					aria-invalid={state.errors?.commentBody ? true : undefined}
					placeholder="Add a note for the team"
					className={`${textareaClass} mt-1.5 mb-4`}
				/>
				{state.errors?.commentBody ? (
					<p className="-mt-2 mb-3 text-[11px] font-semibold text-red-600">
						{state.errors.commentBody[0]}
					</p>
				) : null}

				<div className="grid gap-4 sm:grid-cols-3">
					<ProjectSelect
						projects={projects}
						defaultValue={projects[0]?.id ?? 0}
						invalid={Boolean(state.errors?.projectId)}
						idPrefix="cwc"
					/>

					<AssigneeSelect people={people} defaultValue={null} idPrefix="cwc" />

					{/* spec/contract.md: the create-with-comment form carries the
					    create-task fields plus the comment fields, so it needs
					    `status` too — the API's validator requires it. */}
					<StatusSelect
						defaultValue="todo"
						invalid={Boolean(state.errors?.status)}
						idPrefix="cwc"
					/>

					<div>
						<label htmlFor="cwc-author" className={labelClass}>
							Comment author
						</label>
						<select
							id="cwc-author"
							name="commentAuthorId"
							className={selectClass}
							defaultValue={people[0]?.id ?? ""}
						>
							{people.map((person) => (
								<option key={person.id} value={person.id}>
									{person.name}
								</option>
							))}
						</select>
					</div>
				</div>

				<div className="mt-5 flex items-center justify-end gap-2">
					<Link to="/tasks" className={cancelClass}>
						Cancel
					</Link>
					<button type="submit" disabled={pending} className={createClass}>
						{pending ? "Creating…" : "Create with comment"}
					</button>
				</div>
			</form>
		</Panel>
	);
}
