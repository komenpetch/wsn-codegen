import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/wsn-codegen/", // GitHub Pages project path (repo name)
  plugins: [react()],
  test: {
    environment: "node",      // engine is pure; node is fastest
    // One suite. Before the netlayer merge this had to name two roots, and
    // while netlayer/ was only in its OWN config `npm test` here reported green
    // while 40 tests never ran -- including the freeze guard whose whole job is
    // to catch an engine change moving the published app-layer output. CI runs
    // this command, so leaving one out meant such a regression deployed.
    include: ["tests/**/*.test.ts"],
  },
});
