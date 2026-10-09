// `{{TOKEN}}` resolution for build args (plan §4). A build arg such as the SPA's
// `VITE_API_URL: "http://localhost:{{API_PORT}}"` can only be resolved *after*
// port allocation, before `compose build`. Unknown tokens are an error: a typo
// in a manifest must fail loudly rather than silently ship a literal `{{…}}`.

const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export type TokenEnv = Readonly<Record<string, string | number>>;

export function resolveTokens(value: string, env: TokenEnv): string {
  return value.replace(TOKEN, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(env, name)) {
      throw new Error(`unknown manifest token {{${name}}} (known: ${Object.keys(env).sort().join(", ")})`);
    }
    return String(env[name]);
  });
}

export function resolveTokenMap(
  map: Readonly<Record<string, string>> | undefined,
  env: TokenEnv,
): Record<string, string> | undefined {
  if (!map) return undefined;
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, resolveTokens(value, env)]),
  );
}
