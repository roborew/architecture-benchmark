import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import type { ParentComponent } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { useServerAction, withId } from "@/hooks/use-server-action";
import {
	cancelClass,
	createClass,
	inputClass,
	labelClass,
	selectClass,
	textareaClass,
} from "@/lib/form-styles";
import type { Project, Task, User } from "@/lib/types";
import {
	createTaskFn,
	createTaskWithCommentFn,
	ID_FIELD,
	updateTaskFn,
} from "@/server/mutations";

const STATUSES: { value: Task["status"]; label: string }[] = [
	{ value: "todo", label: "To do" },
	{ value: "in progress", label: "In progress" },
	{ value: "done", label: "Done" },
];

function ProjectSelect(props: {
	projects: Project[];
	defaultValue: number;
	invalid?: boolean;
	idPrefix: string;
}) {
	return (
		<div>
			<label for={`${props.idPrefix}-project`} class={labelClass}>
				Project
			</label>
			<select
				id={`${props.idPrefix}-project`}
				name="projectId"
				value={String(props.defaultValue)}
				aria-invalid={props.invalid ? true : undefined}
				class={selectClass}
			>
				<For each={props.projects}>
					{(project) => <option value={project.id}>{project.name}</option>}
				</For>
			</select>
		</div>
	);
}

function AssigneeSelect(props: {
	people: User[];
	defaultValue: number | null;
	invalid?: boolean;
	idPrefix: string;
}) {
	return (
		<div>
			<label for={`${props.idPrefix}-assignee`} class={labelClass}>
				Assigned user
			</label>
			<select
				id={`${props.idPrefix}-assignee`}
				name="assigneeId"
				value={props.defaultValue === null ? "" : String(props.defaultValue)}
				aria-invalid={props.invalid ? true : undefined}
				class={selectClass}
			>
				<option value="">Unassigned</option>
				<For each={props.people}>
					{(person) => <option value={person.id}>{person.name}</option>}
				</For>
			</select>
		</div>
	);
}

function StatusSelect(props: {
	defaultValue: Task["status"];
	invalid?: boolean;
}) {
	return (
		<div>
			<label for="task-status" class={labelClass}>
				Status
			</label>
			<select
				id="task-status"
				name="status"
				value={props.defaultValue}
				aria-invalid={props.invalid ? true : undefined}
				class={selectClass}
			>
				<For each={STATUSES}>
					{(status) => <option value={status.value}>{status.label}</option>}
				</For>
			</select>
		</div>
	);
}

function FormMessage(props: { message?: string | null }) {
	return (
		<Show when={props.message}>
			<p
				role="alert"
				class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
			>
				{props.message}
			</p>
		</Show>
	);
}

function Panel(props: ParentComponent) {
	return (
		<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
			<div class="max-w-3xl p-5">{props.children}</div>
		</section>
	);
}

export function TaskForm(props: {
	projects: Project[];
	people: User[];
	task?: Task;
}) {
	const isEdit = () => props.task !== undefined;

	const create = useServerFn(createTaskFn);
	const update = useServerFn(updateTaskFn);

	const [state, formAction, pending] = useServerAction((fd: FormData) =>
		isEdit()
			? update({ data: withId(fd, ID_FIELD.task, props.task!.id) })
			: create({ data: fd }),
	);

	const [title, setTitle] = createSignal(props.task?.title ?? "");
	const [description, setDescription] = createSignal(
		props.task?.description ?? "",
	);

	return (
		<div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div class="mb-7">
				<p class="mb-2 text-[11px] font-medium text-slate-500">
					Tasks / {isEdit() ? props.task!.title : "New task"}
				</p>
				<h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
					{isEdit() ? "Edit task" : "New task"}
				</h1>
				<p class="mt-1.5 text-[13px] leading-6 text-slate-500">
					{isEdit()
						? "Update this task. Clearing the assignee leaves it unassigned."
						: "Select the project and user that this task belongs to."}
				</p>
			</div>

			<div class="grid gap-5">
				<Panel>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							formAction(new FormData(e.currentTarget));
						}}
						data-testid="create-task-form"
					>
						<FormMessage message={state().message} />

						<label for="task-title" class={labelClass}>
							Title
						</label>
						<input
							id="task-title"
							name="title"
							required
							maxLength={200}
							value={title()}
							onInput={(event) => setTitle(event.currentTarget.value)}
							placeholder="What needs to be done?"
							aria-invalid={state().errors?.title ? true : undefined}
							aria-describedby={
								state().errors?.title ? "task-title-error" : undefined
							}
							class={`${inputClass} mb-1`}
						/>
						<Show when={state().errors?.title} fallback={<div class="mb-3" />}>
							<p
								id="task-title-error"
								class="mb-3 text-[11px] font-semibold text-red-600"
							>
								{state().errors!.title[0]}
							</p>
						</Show>

						<label for="task-description" class={labelClass}>
							Description
						</label>
						<textarea
							id="task-description"
							name="description"
							value={description()}
							onInput={(event) => setDescription(event.currentTarget.value)}
							placeholder="Add context (optional)"
							class={`${textareaClass} mt-1.5 mb-0`}
						/>

						<div class="grid gap-4 sm:grid-cols-3">
							<Show
								when={isEdit()}
								fallback={
									<ProjectSelect
										projects={props.projects}
										defaultValue={props.projects[0]?.id ?? 0}
										invalid={Boolean(state().errors?.projectId)}
										idPrefix="task"
									/>
								}
							>
								<div>
									<span class={labelClass}>Project</span>
									<p class="text-[12px] text-slate-700">
										{props.projects.find((p) => p.id === props.task!.projectId)
											?.name ?? `Project ${props.task!.projectId}`}
									</p>
								</div>
							</Show>

							<AssigneeSelect
								people={props.people}
								defaultValue={null}
								invalid={Boolean(state().errors?.assigneeId)}
								idPrefix="task"
							/>

							<StatusSelect
								defaultValue={props.task?.status ?? "todo"}
								invalid={Boolean(state().errors?.status)}
							/>
						</div>

						<Show when={state().errors?.assigneeId}>
							<p class="mt-2 text-[11px] font-semibold text-red-600">
								{state().errors!.assigneeId[0]}
							</p>
						</Show>

						<div class="mt-5 flex items-center justify-end gap-2">
							<Show
								when={isEdit()}
								fallback={
									<Link to="/tasks" class={cancelClass}>
										Cancel
									</Link>
								}
							>
								<Link
									to="/tasks/$id"
									params={{ id: String(props.task!.id) }}
									class={cancelClass}
								>
									Cancel
								</Link>
							</Show>
							<button type="submit" disabled={pending()} class={createClass}>
								{pending()
									? isEdit()
										? "Saving…"
										: "Creating…"
									: isEdit()
										? "Save changes"
										: "Create task"}
							</button>
						</div>
					</form>
				</Panel>

				<Show when={!isEdit()}>
					<CreateWithCommentForm
						projects={props.projects}
						people={props.people}
					/>
				</Show>
			</div>
		</div>
	);
}

function CreateWithCommentForm(props: { projects: Project[]; people: User[] }) {
	const createWithComment = useServerFn(createTaskWithCommentFn);

	const [state, formAction, pending] = useServerAction((fd: FormData) =>
		createWithComment({ data: fd }),
	);

	return (
		<Panel>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					formAction(new FormData(e.currentTarget));
				}}
				data-testid="create-with-comment-form"
			>
				<h2 class="mb-1 text-[15px] font-bold tracking-[-.02em] text-slate-800">
					New task with a first comment
				</h2>
				<p class="mb-4 text-[12px] leading-6 text-slate-500">
					The task and its opening comment are written together, so either both
					exist or neither does.
				</p>

				<FormMessage message={state().message} />

				<label for="cwc-title" class={labelClass}>
					Title
				</label>
				<input
					id="cwc-title"
					name="title"
					required
					maxLength={200}
					aria-invalid={state().errors?.title ? true : undefined}
					placeholder="What needs to be done?"
					class={`${inputClass} mb-4`}
				/>
				<Show when={state().errors?.title}>
					<p class="-mt-2 mb-3 text-[11px] font-semibold text-red-600">
						{state().errors!.title[0]}
					</p>
				</Show>

				<label for="cwc-comment" class={labelClass}>
					First comment
				</label>
				<textarea
					id="cwc-comment"
					name="commentBody"
					required
					aria-invalid={state().errors?.commentBody ? true : undefined}
					placeholder="Add a note for the team"
					class={`${textareaClass} mt-1.5 mb-4`}
				/>
				<Show when={state().errors?.commentBody}>
					<p class="-mt-2 mb-3 text-[11px] font-semibold text-red-600">
						{state().errors!.commentBody[0]}
					</p>
				</Show>

				<div class="grid gap-4 sm:grid-cols-3">
					<ProjectSelect
						projects={props.projects}
						defaultValue={props.projects[0]?.id ?? 0}
						invalid={Boolean(state().errors?.projectId)}
						idPrefix="cwc"
					/>

					<AssigneeSelect
						people={props.people}
						defaultValue={null}
						idPrefix="cwc"
					/>

					<div>
						<label for="cwc-author" class={labelClass}>
							Comment author
						</label>
						<select
							id="cwc-author"
							name="commentAuthorId"
							class={selectClass}
							value={props.people[0]?.id ?? ""}
						>
							<For each={props.people}>
								{(person) => <option value={person.id}>{person.name}</option>}
							</For>
						</select>
					</div>
				</div>

				<div class="mt-5 flex items-center justify-end gap-2">
					<Link to="/tasks" class={cancelClass}>
						Cancel
					</Link>
					<button type="submit" disabled={pending()} class={createClass}>
						{pending() ? "Creating…" : "Create with comment"}
					</button>
				</div>
			</form>
		</Panel>
	);
}
