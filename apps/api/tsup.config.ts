import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/db/migrate.ts", "src/worker.ts", "src/telemetry.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  // npm packages stay external (installed in the image); only our TS workspace packages are bundled.
  skipNodeModulesBundle: true,
  noExternal: [/^@zuno\//],
  onSuccess: "cp -r drizzle dist/",
});
