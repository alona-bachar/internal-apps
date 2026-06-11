import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const runnerSdkShimPath = fileURLToPath(
  new URL("./runner/sdk-shim.ts", import.meta.url),
);

export default defineConfig(({ command, mode }) => {
  if (mode === "runner") {
    return {
      plugins: [react()],
      root: "runner",
      server: {
        fs: {
          allow: [".."],
        },
      },
      resolve: {
        alias: {
          "@wonderful/app-sdk": runnerSdkShimPath,
        },
      },
      build: {
        outDir: "../runner-dist",
        emptyOutDir: true,
      },
    };
  }

  if (command === "serve") {
    return {
      plugins: [react()],
      root: "dev",
      resolve: {
        alias: {
          "@wonderful/app-sdk": runnerSdkShimPath,
        },
      },
    };
  }

  return {
    plugins: [react()],
    root: ".",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      lib: {
        entry: "src/index.ts",
        formats: ["es"],
        fileName: "app",
      },
      rollupOptions: {
        external: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "@wonderful/ui-base",
          "@wonderful/app-sdk",
          // Platform-shared packages — uncomment when you install them
          // so your bundle uses the host's copy instead of shipping its own.
          // See the "URL state" guide in the Wonderful Apps docs.
          // "react-router-dom",
          // "use-query-params",
        ],
      },
      cssCodeSplit: false,
    },
  };
});
