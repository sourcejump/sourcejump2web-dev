import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Visual values live in design tokens (src/ui/tokens.css). Outside src/ui/, strings that look like a
// raw color or an arbitrary Tailwind value (`w-[13px]`, `bg-[#fff]`, `[color:red]`) are errors.
const rawValueRules = [
  [
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
    "Raw hex color: use a color token (`bg-surface`, `text-accent`, …) instead.",
  ],
  [
    /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/,
    "Raw color function: use a color token instead.",
  ],
  [
    // A bracket followed by `:` is a variant (`aria-[current=page]:`), which is allowed.
    /(?:^|[\s:])-?[a-z][\w-]*-\[[^\]]+\](?!:)/,
    "Arbitrary Tailwind value: use a token-backed utility, or add a primitive in src/ui/.",
  ],
  [
    /(?:^|[\s:])\[[a-z-]+:[^\]]+\]/,
    "Arbitrary Tailwind property: use a token-backed utility, or add a primitive in src/ui/.",
  ],
].flatMap(([pattern, message]) => [
  { selector: `Literal[value=${pattern}]`, message },
  { selector: `TemplateElement[value.raw=${pattern}]`, message },
]);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ui/**", "src/api/schema.ts"],
    rules: { "no-restricted-syntax": ["error", ...rawValueRules] },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ui/Link.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Only the component; its hooks are fine anywhere.
          name: "next/link",
          importNames: ["default"],
          message: "Use Link from @/ui/Link, which turns off prefetching.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored renderer, kept close to upstream so its fixes can be compared and taken in.
    "src/features/replays/viewer/noclip/**",
  ]),
]);

export default eslintConfig;
