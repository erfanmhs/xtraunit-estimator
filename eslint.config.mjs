import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A newer react-hooks plugin (pulled in via eslint-config-next) promotes
    // these two opinionated rules to errors. They flag long-standing, working
    // patterns across this codebase — prop-sync effects and hoisted helper
    // functions — none of which are bugs. Keep them visible as warnings so they
    // don't break `next build`. (tsc still gates real type errors.)
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
