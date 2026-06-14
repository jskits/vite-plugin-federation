import { defineConfig } from 'vitepress';

const repoUrl = 'https://github.com/jskits/vite-plugin-federation';
const siteUrl = 'https://jskits.github.io/vite-plugin-federation/';

const nav = [
  { text: 'Guide', link: '/getting-started' },
  { text: 'Runtime', link: '/production-runtime' },
  { text: 'API', link: '/plugin-api' },
  { text: 'Reference', link: '/reference/' },
  { text: 'Comparison', link: '/comparison' },
];

const sidebar = [
  {
    text: 'Start',
    items: [
      { text: 'Overview', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Public API Contract', link: '/public-api-contract' },
      { text: 'Plugin API', link: '/plugin-api' },
      { text: 'Runtime API', link: '/runtime-api' },
    ],
  },
  {
    text: 'Runtime And Production',
    items: [
      { text: 'Manifest Protocol', link: '/manifest-protocol' },
      { text: 'Production Runtime', link: '/production-runtime' },
      { text: 'Preload And Performance', link: '/preload-performance' },
      { text: 'Multi-Tenant Isolation', link: '/multi-tenant' },
      { text: 'Security', link: '/security' },
      { text: 'Troubleshooting', link: '/troubleshooting' },
    ],
  },
  {
    text: 'Development',
    items: [
      { text: 'Dev Remote HMR', link: '/dev-hmr' },
      { text: 'DTS Workflows', link: '/dts-workflows' },
      { text: 'DevTools Contract', link: '/devtools-runtime-contract' },
      { text: 'Compiler Adapter', link: '/compiler-adapter' },
      { text: 'Compatibility Matrix', link: '/compatibility-matrix' },
    ],
  },
  {
    text: 'Migration',
    items: [
      { text: 'Plugin Comparison', link: '/comparison' },
      { text: 'From @module-federation/vite', link: '/migrate-from-module-federation-vite' },
      { text: 'From OriginJS', link: '/originjs-migration' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Reference Index', link: '/reference/' },
      { text: 'Package Metadata', link: '/reference/package' },
      { text: 'Examples', link: '/reference/examples' },
      { text: 'Schemas And Fixtures', link: '/reference/schemas' },
      { text: 'LLMs', link: '/llms' },
    ],
  },
  {
    text: 'Project',
    items: [
      { text: 'Release Checklist', link: '/release-checklist' },
      { text: 'Production Readiness', link: '/remaining-production-todos' },
      { text: '1.0 Article', link: '/articles/vite-plugin-federation-v1.0' },
    ],
  },
];

export default defineConfig({
  lang: 'en-US',
  title: 'vite-plugin-federation',
  description: 'Production-grade Module Federation for Vite, Rolldown, and SSR.',
  base: '/vite-plugin-federation/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: '/vite-plugin-federation/logo.svg', type: 'image/svg+xml' }],
    ['link', { rel: 'canonical', href: siteUrl }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'vite-plugin-federation' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Manifest-first Module Federation for Vite hosts, remotes, SSR, and production rollout controls.',
      },
    ],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
  ],
  markdown: {
    toc: { level: [2, 3] },
  },
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'vite-plugin-federation',
    nav,
    sidebar,
    editLink: {
      pattern: `${repoUrl}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: repoUrl }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright JS Kits.',
    },
  },
});
