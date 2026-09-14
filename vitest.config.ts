import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scope discovery to the real test directory: without this, vitest also
    // scans .direnv/flake-inputs (a Nix store checkout) and picks up unrelated
    // *.test.ts files from dependencies.
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".direnv/**"],
  },
});
