import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Vite answers only to hosts it knows. A Cloudflare quick tunnel gives the
    // preview a *.trycloudflare.com address, which without this is refused
    // with "Blocked request" — used to show the interface to a colleague who
    // isn't on this network. The preview runs on invented sample data
    // (src/lib/devMock.ts); the real app and its database are native and are
    // not reachable this way.
    allowedHosts: [".trycloudflare.com"],
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
