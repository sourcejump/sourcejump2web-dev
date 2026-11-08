# Design system
One visual language for every page, so pages can't drift apart. See it at `/dev/ui` (dev builds only).

## Direction
"Classic" (2026-11-07): the old sourcejump.net, updated. Replaced "Navy".
- A slate sheet (`bg`, `shadow-sheet`) between darker gutters. One cyan accent; at most one primary button per view.
- Gamified but professional: medals, tier colors, WR badges, count-ups and small motions. No mascots, confetti, slogans or sales copy.
- Geist: 450 regular, 700 bold, matched to the old Play; Exo 2 bold (`font-server`) for server names. Times and tables use equal-width digits.
- Corners: `rounded-md` (8px) for every frame, from a panel to a field or button; `rounded-sm` (4px) for badges and rows inside a frame.

## Tokens
`web/src/ui/tokens.css` holds every color, type size, radius, shadow and easing as Tailwind theme variables. Tailwind's own palette, radii, type scale and shadows are cleared, so `bg-red-500` or `rounded-3xl` don't compile. Spacing keeps Tailwind's 4px grid. Breakpoints add `xs` (360px) for the narrowest phones.
- Surfaces, darkest to lightest: `bg`, `surface`, `surface-raised`, `surface-overlay`. Borders: `border`, `border-strong`.
- Text: `text`, `text-muted`, `text-subtle`. Accent: `accent`, `accent-hover`, `accent-soft`, `on-accent`.
- Status: `success`, `warning`, `danger`, each with a `-soft` tint. Medals: `gold`, `silver`, `bronze`, `on-medal`.
- Tiers: four ramp stops, `tier-1` (easiest) to `tier-4` (hardest). The tier count is staff data (`domain.md`), so `TierBadge` colors a tier by its position on the ramp, which works for any count.

**Rule:** outside `web/src/ui/`, no raw colors and no arbitrary Tailwind values (`w-[13px]`, `bg-[#fff]`, `[color:red]`). ESLint enforces it (`web/eslint.config.mjs`, tested in `eslint.config.test.ts`). If a page needs something the tokens can't express, add or extend a primitive in `src/ui/`.

## Primitives (`web/src/ui/`)
| Component | Use |
|---|---|
| `Page` | Every page's content area; `width` is `wide`, `narrow` (reading) or `fill` (inside a section layout that sets its own width, such as the staff area). Runs the page fade |
| `Masthead` | Full-width top band, plain or over a map picture, in `Page width="fill"` (Players pages) |
| `Link` | Every internal link; never prefetches. Lint blocks importing `next/link` elsewhere |
| `Button`, `ButtonLink`, `ButtonAnchor` | `primary` (one per view), `secondary` (default), `ghost`; sizes `sm`, `md`. A `ghost` button with `aria-pressed` or `aria-expanded` shows the accent while on. `ButtonAnchor` is for full page loads, such as sign-in |
| `Card`, `Label` | Bordered surface; `interactive` adds the hover lift. `Label` is the small uppercase heading |
| `StatCard` | Headline number with label and icon, counting up, and an optional detail beside the number (not under it, so a row of cards stays one height). `null` shows a dash |
| `Badge` | Short status: `neutral`, `accent` (WR), `success`, `warning`, `danger` |
| `Medal` | Placement; medals for 1–3, a plain number after |
| `TierBadge` | `tier` and `tierCount` from the API |
| `Avatar` | Steam avatar or initials; `sm` to `xl` |
| `Flag` | Country flag from an ISO code, a grey placeholder without one; `hint` replaces its tooltip |
| `Table` + `TableHead`/`TableBody`/`TableRow`/`TableHeaderCell`/`TableCell` | `numeric` cells right-align, `centered` heads center on narrow marks, `wrap` cells wrap. Scrolls sideways if too wide; `phoneLead` + `phoneFill` size a phone's first view to end at a column's edge |
| `Tabs` | Panels on one page; `underline` or `segmented` |
| `LinkTabs` | Looks like `Tabs`, but each tab is a link: a view the server renders, such as the Maps page's sort |
| `Segmented` | Looks like segmented `Tabs`, for a choice that changes the view in place, e.g. a chart range. The chosen option is in the accent |
| `ChoiceMenu` | "Label  Value ▾": one choice from a list, in a `Menu` of radio items, changing the view in place, or following each option's `href` on a server page. Boards, profiles and the Maps page use a row of them (lead, 2026-10-26); Style lists Autosync after Normal (`menuOrder`); quiet options are dimmed but choosable, disabled ones dimmed and kept in place. Word-width on phones too, so they sit side by side |
| `ChoiceBar` | The row those menus sit in, with any tabs beside them. Every page uses it, so the spacing between choices stays the same everywhere |
| `Pager` | Page links under a paged list; `param`: its address key. Reserves its widest row, so turning a page never moves it |
| `DividedList`, `DividedSection` | Rows with lines between them, and a part set off by a line above, inside a `Card` or `Dialog`. The lines run to the surface's edges |
| `StepChart` | A value that changes in steps over time (WR history). Hover snaps a crosshair to the nearest point; points take focus and open their link |
| `LineChart` | One count over time from zero (players online). Drawn in a CSS-stretched box, so it fills its container before scripts load. Hover, tap or arrow keys pick a point; the parent shows its values. An optional second line (`y2`, gold) shows a part of the first on the same scale (world records among runs). Never two scales on one chart |
| `TierSpread` | Maps per tier: a donut beside each tier's count and share; slices and rows link to that tier's maps, the rest dim; "All tiers" goes back (Maps page) |
| `Dot` | "·" in a wrapping line; hidden on phones, where it could end one |
| `Tooltip` | Hint on hover and focus; its child must take focus |
| `Menu`, `MenuItem`, `MenuLink`, `MenuSeparator` | Menu button (account; `sheet`: phone menu) |
| `Dialog` | Controlled modal (`open`, `onClose`). A field marked `data-autofocus` takes focus on each opening, not just the first. Closes itself, without calling `onClose`, when its page is hidden for Back |
| `BrandIcon`, `SteamButton` | Community and Steam logos (`colored`: in their own colors); Steam sign-in |
| `Input`, `SearchField`, `Textarea`, `CountUp` | Text field with optional icon; search, button inside; multi-line field; animated number |
| `Prose` | Long-form HTML (a post's body) in the site's type. Only for HTML the API made safe |

The run dialog opens in place: `RunLink` pushes `?run=<id>` to the address and `RunDialogHost` (root layout) loads the run. Back or Escape closes it; the address can be shared. A run link's `href` is `/runs/{id}`, the run's own page, for new tabs. A map page's style and track work the same way, with `replaceState`.

A `className` passed to a primitive is for placement (margin, width, grid), not restyling. Domain components (`RunRow`, `RunDialog`, …) live in `src/features/<feature>/` and are built from these.

Overlays use the platform: `<dialog>` for Dialog, the `popover` attribute with CSS anchor positioning for Menu and Tooltip. The browser handles focus trapping, Escape, outside clicks and stacking; our code adds WAI-ARIA keyboard movement.

## Motion (`web/src/ui/motion.css`)
Named utilities, so pages never write their own transitions:
- `motion-enter`: fade and rise; stagger with `--motion-delay`.
- `motion-lift`: hover lift for clickable cards.
- `motion-rank-change`: a row that moved; re-key it to replay.
- `motion-wr-highlight`: accent ring that pulses on a new WR.
- `motion-draw`: an SVG line drawing itself in (a run's route); the shape needs `pathLength="1"`.
- `motion-reveal`: a section rising in as it scrolls into view (scroll-driven; browsers without it show it at once).
- `motion-settle`: a large picture easing out of a slight zoom as the page opens (the home header).
- `HeaderDepth` (`features/home/`): the home header's picture leans with the mouse, by a depth map of it (`scripts/header-depth.py`; rerun it when the picture changes). Dust drifts in the light shaft, and a click sends cyan traces crawling over the surfaces (`headerTraces.ts`). WebGL, only while on screen; off on touch screens and with reduced motion. The buttons above it get their own layer (`will-change-transform`): without it GPU Chromium dropped a hover's color after a frame.
- `motion-pop`: a menu fading in with a slight drop and grow (`Menu`); `motion-fade`: its `sheet`'s dim.
- `CountUp`: counts up when scrolled into view, and from the old value when it changes. A number already in view when the page loads stays as it is.
- `page-fade`: between pages (see Navigation).

All of them respect `prefers-reduced-motion` and show their end state at once.

## Navigation
Pages swap in place: the old page fades out and the new one in (React's `<ViewTransition>` in `Page`, `page-fade` in `motion.css`); the header has its own transition name, so it stays still. Without view transitions, pages just swap. A page with views (a map and its Manage view) keeps its header in a route layout and wraps each view in `PageView`, which fades one out and lifts the next in (`view-flip`).

Links never prefetch, whether in view or hovered (lead's choice, 2026-10-19). A page loads only once it's opened, and the fade covers the wait. `e2e/navigation.e2e.ts` checks that following a link doesn't reload the page.

## Layout shell (`web/src/features/site/`)
Header, page and footer sit on the sheet. The header is one sticky bar: wordmark, sections, search (`/`), Steam sign-in; footer: one line, community logos. Phones: menu, wordmark, search, account. Account and current section sit in `<Suspense>`, so every shell stays static. Search lives on the Players page.

## Screenshot tests
`npm run test:ui` (part of `just check`) screenshots `/dev/ui` wide, on a phone, with the menu open and with the dialog open, and fails on any pixel change. After an intended visual change:
```
cd web && npx playwright test --update-snapshots=all
```
Review the new PNGs in `web/e2e/style-guide.e2e.ts-snapshots/` and commit them with the change. Playwright uses the system Chrome (`channel: "chrome"`) and reuses a running dev server. Baselines are rendered on Linux; another platform needs its own.
