import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import ActionTag from "./ActionTag.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ActionTag", ActionTag);
  },
} satisfies Theme;
