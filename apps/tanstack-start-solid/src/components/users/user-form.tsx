import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show } from "solid-js";

import type { User } from "@/lib/types";
import { ID_FIELD, createUserFn, updateUserFn } from "@/server/mutations";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
} from "@/lib/form-styles";
import { useServerAction, withId } from "@/hooks/use-server-action";

export function UserForm(props: { person?: User }) {
  const isEdit = () => props.person !== undefined;

  const create = useServerFn(createUserFn);
  const update = useServerFn(updateUserFn);

  const [state, formAction, pending] = useServerAction((fd: FormData) =>
    isEdit()
      ? update({ data: withId(fd, ID_FIELD.user, props.person!.id) })
      : create({ data: fd }),
  );

  const [name, setName] = createSignal(props.person?.name ?? "");
  const [email, setEmail] = createSignal(props.person?.email ?? "");

  return (
    <div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div class="mb-7">
        <p class="mb-2 text-[11px] font-medium text-slate-500">
          People / {isEdit() ? props.person!.name : "New user"}
        </p>
        <h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          {isEdit() ? "Edit user" : "New user"}
        </h1>
        <p class="mt-1.5 text-[13px] leading-6 text-slate-500">
          {isEdit()
            ? "Update the name and email address of this workspace member."
            : "Add a workspace member before assigning them tasks."}
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

          <label for="user-name" class={labelClass}>
            Name
          </label>
          <input
            id="user-name"
            name="name"
            required
            maxLength={200}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder="e.g. Alex Morgan"
            aria-invalid={state().errors?.name ? true : undefined}
            aria-describedby={
              state().errors?.name ? "user-name-error" : undefined
            }
            class={`${inputClass} mb-1`}
          />
          <Show when={state().errors?.name} fallback={<div class="mb-3" />}>
            <p
              id="user-name-error"
              class="mb-3 text-[11px] font-semibold text-red-600"
            >
              {state().errors!.name[0]}
            </p>
          </Show>

          <label for="user-email" class={labelClass}>
            Email
          </label>
          <input
            id="user-email"
            name="email"
            type="email"
            required
            value={email()}
            onInput={(event) => setEmail(event.currentTarget.value)}
            placeholder="alex@example.test"
            aria-invalid={state().errors?.email ? true : undefined}
            aria-describedby={
              state().errors?.email ? "user-email-error" : undefined
            }
            class={`${inputClass} mb-1`}
          />
          <Show when={state().errors?.email} fallback={<div class="mb-3" />}>
            <p
              id="user-email-error"
              class="mb-3 text-[11px] font-semibold text-red-600"
            >
              {state().errors!.email[0]}
            </p>
          </Show>

          <div class="mt-2 flex items-center justify-end gap-2">
            <Show
              when={isEdit()}
              fallback={
                <Link to="/users" class={cancelClass}>
                  Cancel
                </Link>
              }
            >
              <Link
                to="/users/$id"
                params={{ id: String(props.person!.id) }}
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
                  : "Create user"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
