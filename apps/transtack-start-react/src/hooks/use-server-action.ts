// src/hooks/use-server-action.ts
//
// The bridge between a form and a TanStack server function.
//
// The Next.js app used `useActionState` and got three things from it: the
// server function's return value as `state`, a `pending` flag, and a
// `<form action={...}>` handler. It got a fourth for free — the action itself
// called `revalidatePath` and then `redirect`, so the browser was already on the
// new page by the time the form settled.
//
// TanStack Start has no `revalidatePath`, and a `redirect()` thrown inside a
// server function would navigate before the client had refreshed its loaders.
// So the responsibilities are split:
//
//   src/lib/actions.ts        returns `{ errors, message, redirectTo }`
//   src/server/mutations.ts   wraps that in a createServerFn
//   this hook                 calls it, invalidates the router, then navigates
//
// The result is a `useActionState`-shaped tuple, so the forms read the same as
// they did under Next.js.

import { useRouter } from "@tanstack/react-router";
import { useCallback, useState, useTransition } from "react";

import type { ActionResult, State } from "@/lib/actions";

export const initialActionState: State = {};

/**
 * A bound server function: takes the form's FormData and resolves to the
 * action's outcome.
 */
type ActionFn = (formData: FormData) => Promise<ActionResult>;

/**
 * Appends a bound id to the form's own fields.
 *
 * FormData is only serialisable as the top-level payload of a POST body, so an
 * id cannot ride alongside it as a sibling property — it has to be a field of
 * the same FormData. That is also what a plain form POST carrying a hidden
 * input would have done.
 *
 * The incoming FormData is copied rather than mutated: it is the one React
 * handed the form, and a component may still read it after submit.
 */
export function withId(
  formData: FormData,
  field: string,
  id: number,
): FormData {
  const next = new FormData();

  // Copied entry by entry rather than `new FormData(formData)`: TypeScript's
  // lib.dom types the constructor's first parameter as HTMLFormElement, so
  // passing a FormData does not typecheck even though every runtime accepts it.
  for (const [key, value] of formData) {
    next.append(key, value);
  }

  next.set(field, String(id));

  return next;
}

export function useServerAction(
  action: ActionFn,
): [state: State, formAction: (formData: FormData) => void, pending: boolean] {
  const router = useRouter();
  const [state, setState] = useState<State>(initialActionState);
  const [isPending, startTransition] = useTransition();

  const formAction = useCallback(
    (formData: FormData) => {
      startTransition(async () => {
        const result = await action(formData);

        // A validation failure is not a successful mutation, so it must not
        // invalidate: the route's data is still correct, and re-running the
        // loaders would only cost a round trip.
        if (result.redirectTo === undefined) {
          setState(result);
          return;
        }

        // Invalidate before navigating. `redirectTo` often names the route the
        // user is already on (creating a task redirects to /tasks), and
        // navigating first would render the stale list and then re-render under
        // the user with the new row.
        await router.invalidate();

        setState({});

        // The action returns a resolved path such as `/tasks/101`, not a route
        // pattern plus params, so it is passed as `to` with the cast that
        // expresses "this string is a full path". TanStack resolves it against
        // the route tree, which also keeps the browser URL and the loader's
        // params in sync.
        await router.navigate({ to: result.redirectTo as never });
      });
    },
    [action, router],
  );

  return [state, formAction, isPending];
}
