/**
 * Tailwind CSS v4 is a PostCSS plugin and nothing more. It runs at build time,
 * produces a stylesheet, and adds no runtime, no route and no data access, so the
 * pure-client boundary of SKILL.md section 2 is untouched by it.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
