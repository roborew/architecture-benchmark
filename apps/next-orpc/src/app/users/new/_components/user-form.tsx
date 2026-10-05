"use client";

// One form for both creating and editing a workspace member. `person` is the
// single switch: which mutation runs, whether the fields start populated, and
// what the headings say.
//
// A Client Component because the mutation is an imperative call. This replaced a
// `useActionState` form, so two things changed shape:
//
//   1. There is no <form action={...}> any more — a mutation is a function call,
//      so the form submits through onSubmit and needs JS to submit at all.
//   2. There is no action-supplied state, so the { errors, message } the action
//      used to return is held in `state` below. The JSX that renders it is
//      unchanged, which is the point: tRPC's error contract is the same shape.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ActionResult, FieldErrors } from "@/lib/result";
import type { User } from "@/lib/types";
import { orpc } from "@/orpc/client";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
} from "@/lib/form-styles";

type FormState = { errors?: FieldErrors; message?: string | null };

export function UserForm({ person }: { person?: User }) {
  const isEdit = person !== undefined;

  const queryClient = useQueryClient();
  const router = useRouter();

  // The mutation's reply, held locally — the stand-in for what `useActionState`
  // used to hand this component.
  const [state, setState] = useState<FormState>({});

  // Controlled rather than `defaultValue`, so a rejected submit leaves the typed
  // values in place — exactly the moment the user most needs to see what went
  // wrong.
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");

  // `mutationOptions()` builds the options object; TanStack's useMutation runs
  // it. `orpc` is imported directly — oRPC has no `useTRPC()` equivalent and
  // mounts no provider of its own, so there is no hook to call here. Both are
  // constructed unconditionally so the hook order is stable.
  const created = useMutation(orpc.users.create.mutationOptions());
  const updated = useMutation(orpc.users.update.mutationOptions());
  const pending = isEdit ? updated.isPending : created.isPending;

  /**
   * Shared by both mutations. A refused mutation is expected user error, not an
   * exception, so it renders instead of throwing — the procedure returns
   * { ok: false } and the form shows the field message.
   *
   * On success the Server Action used to call revalidatePath("/") and
   * revalidatePath("/users") before redirecting. Those become query
   * invalidations, and the redirect becomes router.push.
   */
  async function settle(result: ActionResult, destination: string) {
    if (!result.ok) {
      setState({ errors: result.errors, message: result.message });
      return;
    }

    // One partial-match key for the whole `users` namespace, replacing tRPC's
    // separate `trpc.users.list.queryFilter()` and `trpc.users.byId.queryFilter()`.
    // `orpc.users.key()` covers both procedures in a single call, and both need
    // invalidating: a create changes the list, and an update changes the detail
    // page this form redirects to.
    //
    // The braces are required. `.key()` returns an OperationKey — a
    // `[path, options]` tuple — not a bare query key, so it goes in as the
    // `queryKey` property of a filter object. Passing it positionally is a type
    // error, not a silent no-op.
    await queryClient.invalidateQueries({ queryKey: orpc.users.key() });

    router.push(destination);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({});

    if (isEdit && person) {
      updated.mutate(
        { id: person.id, name, email },
        { onSuccess: (result) => settle(result, `/users/${person.id}`) },
      );
      return;
    }

    created.mutate(
      { name, email },
      { onSuccess: (result) => settle(result, "/users") },
    );
  }

  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7">
        <p className="mb-2 text-[11px] font-medium text-slate-500">
          People / {isEdit ? person.name : "New user"}
        </p>
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          {isEdit ? "Edit user" : "New user"}
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          {isEdit
            ? "Update the name and email address of this workspace member."
            : "Add a workspace member before assigning them tasks."}
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <form onSubmit={handleSubmit} className="max-w-2xl p-5">
          {state.message ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
            >
              {state.message}
            </p>
          ) : null}

          <label htmlFor="user-name" className={labelClass}>
            Name
          </label>
          <input
            id="user-name"
            name="name"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Alex Morgan"
            aria-invalid={state.errors?.name ? true : undefined}
            aria-describedby={
              state.errors?.name ? "user-name-error" : undefined
            }
            className={`${inputClass} mb-1`}
          />
          {state.errors?.name ? (
            <p
              id="user-name-error"
              className="mb-3 text-[11px] font-semibold text-red-600"
            >
              {state.errors.name[0]}
            </p>
          ) : (
            <div className="mb-3" />
          )}

          <label htmlFor="user-email" className={labelClass}>
            Email
          </label>
          <input
            id="user-email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="alex@example.test"
            aria-invalid={state.errors?.email ? true : undefined}
            aria-describedby={
              state.errors?.email ? "user-email-error" : undefined
            }
            className={`${inputClass} mb-1`}
          />
          {state.errors?.email ? (
            <p
              id="user-email-error"
              className="mb-3 text-[11px] font-semibold text-red-600"
            >
              {state.errors.email[0]}
            </p>
          ) : (
            <div className="mb-3" />
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <Link
              href={isEdit ? `/users/${person.id}` : "/users"}
              className={cancelClass}
            >
              Cancel
            </Link>
            <button type="submit" disabled={pending} className={createClass}>
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create user"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
