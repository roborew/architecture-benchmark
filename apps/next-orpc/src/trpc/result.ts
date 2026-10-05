// The write contract used to live here, when every mutation lived in a router and
// this module described what the transport returned.
//
// It now lives in src/lib/result.ts, because it describes what the DATA LAYER
// returns: src/lib/data.ts produces these values and the routers pass them
// through untouched. Re-exported here so the components that consume a mutation's
// reply keep importing it from the transport they call through.

export type {
  ActionErr,
  ActionOk,
  ActionResult,
  FieldErrors,
} from "@/lib/result";
