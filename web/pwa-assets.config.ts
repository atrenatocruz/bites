import { combinePresetAndAppleSplashScreens, defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: combinePresetAndAppleSplashScreens(
    minimal2023Preset,
    {
      padding: 0.35,
      resizeOptions: { background: "#FFFFFF", fit: "contain" },
      darkResizeOptions: { background: "#000000", fit: "contain" },
      linkMediaOptions: { log: true, addMediaScreen: true, basePath: "/", xhtml: false },
    },
    ["iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16 Plus", "iPhone 16", "iPhone 14", "iPhone 13 mini"],
  ),
  images: ["public/logo-icon.svg"],
});
