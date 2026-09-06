// Run from ../wsn-codegen (that is where node_modules lives), but collect only
// netlayer's own tests. Absolute, forward-slashed globs: a relative include
// would resolve against the wsn-codegen cwd and silently match nothing.
//
// Deviation from the task brief: this does NOT `import { defineConfig } from
// "vitest/config"`. Vite bundles a standalone config file and, for a bare
// specifier inside it, resolves node_modules starting from the CONFIG FILE'S
// OWN directory (`findNearestNodeModules(path.dirname(configFile))` in
// vite's `loadConfigFromBundledFile`) — not from process.cwd(), and not from
// wherever the `vitest` binary itself was resolved. `netlayer/` has no
// node_modules, and neither does any ancestor directory up to the drive
// root, so ANY bare import here (including "vitest/config") throws
// ERR_MODULE_NOT_FOUND at load time even though `npx vitest` runs fine from
// ../wsn-codegen. `defineConfig` is a type-only identity helper (it returns
// its argument unchanged), so a plain default-exported object is runtime-
// identical and avoids the bare import entirely.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const glob = (p: string) => resolve(HERE, p).replace(/\\/g, "/");

export default {
  test: {
    include: [glob("tests/**/*.test.ts")],
    root: HERE,
  },
};
