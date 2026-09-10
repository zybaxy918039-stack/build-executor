import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const buildAPIKey = env.GEMINI_API_KEY || env.API_KEY || "";

  return {
    server: {
      host: "0.0.0.0",
      port: 3000,
    },
    define: {
      "process.env.API_KEY": JSON.stringify(buildAPIKey),
      "process.env.GEMINI_API_KEY": JSON.stringify(buildAPIKey),
    },
  };
});
