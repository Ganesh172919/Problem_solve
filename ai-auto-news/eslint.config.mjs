import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build artifacts & non-app source:
    "coverage/**",
    "cli/**",
    "sdk/**",
    "k8s/**",
    "terraform/**",
    "prisma/**",
    "experimental-routes/**",
    // Prototype agent/platform modules are intentionally outside the public
    // website lint gate until each module is promoted into a stable surface.
    "src/agents/**",
    "src/lib/**",
    "tests/unit/lib/**",
  ]),
]);

export default eslintConfig;
