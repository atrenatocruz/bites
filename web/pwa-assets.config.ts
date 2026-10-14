import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// iOS launch images (public/apple-splash-*.png) are plain background colours on purpose,
// so only the in-app splash shows the logo; they are not generated here.
// The apple and maskable icons are padded/filled with the brand orange (the preset default is white).
const ORANGE = "#FF5A1F";

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: ORANGE, padding: 0.1 } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: ORANGE, padding: 0 } },
  },
  images: ["public/logo-icon.svg"],
});
