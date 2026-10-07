// src/hooks/use-api-action.ts
//
// The bridge between a form and the REST API.
//
// The reference variant (apps/tanstack-start-react) submits FormData to a
// server function through `useServerAction`, which gets three things from
// React's `useActionState`: the action's return value as `state`, a `pending`
// flag, and a `<form action={…}>` handler. This hook keeps that shape so the
// forms read the same as they did there — only the transport differs.
//
// The responsibilities are split the same way the reference splits them:
//
//   src/lib/api.ts     sends the request and turns failures into ApiError
//   this hook          renders the outcome, invalidates, then navigates
//
// Invalidation is the SPA's `revalidatePath`: a mutation can touch any
// aggregate (a comment count on a list row, a stat card on the dashboard), so
// every query is invalidated rather than guessing which. `router.invalidate()`
// then re-runs the loaders, whose `ensureQueryData` refetches the now-stale
// entries — the two must both happen before the navigation renders the next
// page, or the user sees the stale list re-render under them with the new row.

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useState, useTransition } from "react";

import { ApiError, type FormValues, type MutationResult } from "@/lib/api";

/** The outcome state a form renders: a message, and/or field → messages. */
export type ApiActionState = {
  message?: string;
  errors?: Record<string, string[]>;
};

export const initialApiActionState: ApiActionState = {};

/**
 * A bound api mutation: takes the form's field bag and resolves to the API's
 * outcome envelope, or rejects with an `ApiError`.
 */
type ApiActionFn = (values: FormValues) => Promise<MutationResult>;

/**
 * Reads a form's FormData as the field bag the api client sends.
 *
 * The bound id needs no games here (the reference app smuggles it through the
 * FormData as an extra field): a REST mutation carries its id in the URL, so
 * the action the form binds already closes over it.
 *
 * File inputs are skipped rather than stringified: the API's bodies are all
 * plain fields, and a `File`'s `toString()` would silently send junk.
 */
export function formValues(formData: FormData): FormValues {
  const values: FormValues = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  return values;
}

export function useApiAction(
  action: ApiActionFn,
): [
  state: ApiActionState,
  formAction: (formData: FormData) => void,
  pending: boolean,
] {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ApiActionState>(initialApiActionState);
  const [isPending, startTransition] = useTransition();

  const formAction = useCallback(
    (formData: FormData) => {
      startTransition(async () => {
        let result: MutationResult;

        try {
          result = await action(formValues(formData));
        } catch (error) {
          // The API's own refusals arrive as an ApiError carrying the
          // field errors; anything else (fetch itself rejecting) is a
          // network failure the user still needs to see, not an
          // unhandled rejection inside a transition.
          if (error instanceof ApiError) {
            // An empty errors map is omitted, not spread in: a guard failure
            // (409) carries only a message, and `errors: {}` would make a
            // form's `state.errors?.title` check render an error-free alert.
            setState(
              Object.keys(error.errors).length > 0
                ? { message: error.message, errors: error.errors }
                : { message: error.message },
            );
          } else if (error instanceof Error) {
            setState({ message: error.message });
          } else {
            setState({ message: "Something went wrong. Please try again." });
          }
          return;
        }

        // Invalidate before navigating, exactly as the reference's
        // hook does: `redirectTo` often names the route the user is
        // already on, and navigating first would render the stale list
        // and then re-render under the user with the new row.
        await queryClient.invalidateQueries();
        await router.invalidate();

        setState({});

        // A reply without a redirect (adding a comment) means: stay on
        // this page — the invalidation above is what shows the result.
        if (result.redirectTo !== undefined) {
          // The API returns a resolved path such as /tasks/101, not a
          // route pattern plus params, so it is passed as `to` with the
          // cast that expresses "this string is a full path".
          await router.navigate({ to: result.redirectTo as never });
        }
      });
    },
    [action, queryClient, router],
  );

  return [state, formAction, isPending];
}
