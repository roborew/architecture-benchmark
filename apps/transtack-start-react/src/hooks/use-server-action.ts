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

/** A server function as this hook calls it: form input in, outcome out. */
type ActionFn<Args extends unknown[]> = (...args: Args) => Promise<ActionResult>;

export function useServerAction<Args extends unknown[]>(
  action: ActionFn<Args>,
): [state: State, formAction: (formData: FormData) => void, pending: boolean] {
  const router = useRouter();
  const [state, setState] = useState<State>(initialActionState);
  const [isPending, startTransition] = useTransition();

  const formAction = useCallback(
    (formData: FormData) => {
      startTransition(async () => {
        const result = await action(...([formData] as Args));

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
