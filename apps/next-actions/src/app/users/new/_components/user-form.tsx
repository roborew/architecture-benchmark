"use client";

// One form for both creating and editing a workspace member. As with
// ProjectForm, `person` is the single switch: which action runs, whether the
// fields start populated, and what the headings say.
//
// A Client Component because `useActionState` supplies the validation state and
// the pending flag. The action itself still runs on the server.

import Link from "next/link";
import { useActionState, useState } from "react";

import type { User } from "@/lib/types";
import { createUser, updateUser, type State } from "@/lib/actions";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
} from "@/lib/form-styles";

const initialState: State = {};

export function UserForm({ person }: { person?: User }) {
  const isEdit = person !== undefined;

  // `updateUser` takes the id first; binding it leaves the
  // (previousState, formData) signature `useActionState` expects.
  const action = isEdit ? updateUser.bind(null, person.id) : createUser;

  const [state, formAction, pending] = useActionState(action, initialState);

  // Controlled rather than `defaultValue`. React resets an uncontrolled form
  // once the action it submitted to settles, so a rejected submit would blank
  // the fields the user just typed — exactly the moment they most need to see
  // what went wrong. State also survives a re-render after the action returns.
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");

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
        <form action={formAction} className="max-w-2xl p-5">
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
