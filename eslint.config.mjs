import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";

// ── Lint configuration ──────────────────────────────────────────────────────
// The repo shipped a `lint` script with no linter configured, so `next lint`
// opened an interactive setup prompt and CI had nothing to run. This is that
// missing configuration.
//
// eslint-config-next@15 still publishes the legacy eslintrc format while ESLint
// requires flat config. `FlatCompat` is the supported bridge: it loads the
// legacy config through Node's own resolution, which matters here because
// eslint-config-next redirects plugin resolution to its own bundled copies via
// a require patch — hand-flattening the config loses that and fails to find
// the `next` plugin at all.
//
// The rules are the ones Next ships, not a hand-rolled set: they cover what
// actually bites this codebase — a dependency missing from a hook's array, an
// unsafe `any`, an image without dimensions — without inventing opinions the
// project never agreed to.
//
// Two deliberate exclusions:
//   - `tests/` runs under `bunx tsx`, not a browser, so React-hooks rules that
//     assume a component render are noise there.
//   - `public/sw.js` is a service worker with its own scope, not a module.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // A leading underscore marks a binding that exists to be *absent* — the
    // destructuring omit in lib/modelHealth.ts is the case in point, where
    // `stream_options` is pulled out precisely so the rest can be spread
    // without it. Flagging that as unused would push toward a worse rewrite.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "tests/**",
    "public/sw.js",
  ]),
]);
