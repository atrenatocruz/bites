import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// iOS launch images (public/apple-splash-*.png) are plain background colours on purpose,
// so only the in-app splash shows the logo; they are not generated here.
export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: minimal2023Preset,
  images: ["public/logo-icon.svg"],
});
