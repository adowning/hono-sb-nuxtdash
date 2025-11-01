import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    ui({
      ui: {
        colors: {
          primary: "blue",
          neutral: "slate",
        },
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
