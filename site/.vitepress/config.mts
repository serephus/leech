import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const REPO = "https://github.com/serephus/leech";
const SITE = "https://leech.sereph.us";

// Single source of truth for the version shown in the docs: the root
// package.json, which the monthly release workflow bumps together with the
// tag referenced in README.md.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")
) as { version: string };

const description =
  "A cookie-authenticated LeetCode sync GitHub Action with Nunjucks-templated output, markdown/Typst conversion, submission filters, and lifecycle hooks.";

export default defineConfig({
  title: "leech",
  description,
  lang: "en-US",
  // The custom domain (leech.sereph.us) is configured in the repo's Pages
  // settings. Actions-based deployments serve from the root and ignore any
  // CNAME file, which is why there isn't one in public/.
  base: "/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE },
  vite: {
    define: {
      __LEECH_TAG__: JSON.stringify(`v${pkg.version}`),
    },
  },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["link", { rel: "canonical", href: SITE }],
    ["meta", { name: "theme-color", content: "#047857" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "leech" }],
    ["meta", { property: "og:title", content: "leech" }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:url", content: SITE }],
    ["meta", { name: "twitter:card", content: "summary" }],
  ],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Design", link: "/design/architecture" },
      { text: "Limitations", link: "/limitations" },
      { text: "Development", link: "/development" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "Templates", link: "/guide/templates" },
          { text: "Filters & conversion", link: "/guide/filters" },
          { text: "Assets", link: "/guide/assets" },
          { text: "Hooks", link: "/guide/hooks" },
          { text: "Local CLI", link: "/guide/cli" },
        ],
      },
      {
        text: "Design",
        items: [
          { text: "Architecture", link: "/design/architecture" },
          { text: "Watermark & atomicity", link: "/design/watermark" },
          { text: "Hooks lifecycle", link: "/design/hooks-lifecycle" },
        ],
      },
      {
        text: "More",
        items: [
          { text: "Limitations", link: "/limitations" },
          { text: "FAQ", link: "/faq" },
          { text: "Development", link: "/development" },
          { text: "License", link: "/license" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPO }],
    editLink: {
      pattern: `${REPO}/edit/main/site/:path`,
      text: "Edit this page on GitHub",
    },
    outline: { level: [2, 3], label: "On this page" },
    footer: {
      message:
        "Released under the GLWTPL — absolutely no warranty. Good luck.",
      copyright: "Vibed with DS4 flash",
    },
  },
});
