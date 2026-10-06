import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show } from "solid-js";

import type { Project } from "@/lib/types";
import { ID_FIELD, createProjectFn, updateProjectFn } from "@/server/mutations";
import { useServerAction, withId } from "@/hooks/use-server-action";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
  textareaClass,
} from "@/lib/form-styles";

export function ProjectForm(props: { project?: Project }) {
  const isEdit = () => props.project !== undefined;

  const create = useServerFn(createProjectFn);
  const update = useServerFn(updateProjectFn);

  const [state, formAction, pending] = useServerAction((fd: FormData) =>
    isEdit()
      ? update({ data: withId(fd, ID_FIELD.project, props.project!.id) })
      : create({ data: fd }),
  );

  const [name, setName] = createSignal(props.project?.name ?? "");
  const [description, setDescription] = createSignal(
    props.project?.description ?? "",
  );

  return (
    <div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div class="mb-7">
        <p class="mb-2 text-[11px] font-medium text-slate-500">
          Projects / {isEdit() ? props.project!.name : "New project"}
        </p>
        <h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          {isEdit() ? "Edit project" : "New project"}
        </h1>
        <p class="mt-1.5 text-[13px] leading-6 text-slate-500">
          {isEdit()
            ? "Update the name and description of this project."
            : "Create a project before adding its tasks."}
        </p>
      </div>

      <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            formAction(new FormData(e.currentTarget));
          }}
          class="max-w-2xl p-5"
        >
          <Show when={state().message}>
            <p
              role="alert"
              class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
            >
              {state().message}
            </p>
          </Show>

          <label for="project-name" class={labelClass}>
            Project name
          </label>
          <input
            id="project-name"
            name="name"
            required
            maxLength={200}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder="e.g. Website redesign"
            aria-invalid={state().errors?.name ? true : undefined}
            aria-describedby={
              state().errors?.name ? "project-name-error" : undefined
            }
            class={`${inputClass} mb-1`}
          />
          <Show when={state().errors?.name} fallback={<div class="mb-3" />}>
            <p
              id="project-name-error"
              class="mb-3 text-[11px] font-semibold text-red-600"
            >
              {state().errors!.name[0]}
            </p>
          </Show>

          <label for="project-description" class={labelClass}>
            Description
          </label>
          <textarea
            id="project-description"
            name="description"
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
            placeholder="What is this project for?"
            class={`${textareaClass} mt-1.5 mb-0`}
          />

          <div class="mt-5 flex items-center justify-end gap-2">
            <Link to="/projects" class={cancelClass}>
              Cancel
            </Link>
            <button type="submit" disabled={pending()} class={createClass}>
              {pending()
                ? isEdit()
                  ? "Saving…"
                  : "Creating…"
                : isEdit()
                  ? "Save changes"
                  : "Create project"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
