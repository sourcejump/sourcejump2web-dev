# Design system
One visual language that every page is built from, so pages can't drift apart. See it all at `/dev/ui` (dev builds only).

## Direction
"Navy", chosen by the lead on 2026-10-19 (reference: `design/reference.webp`, a direction, not a target).
- Dark blue slate, never pitch black. One cyan accent; at most one primary button per view.
- Gamified but professional: medals, tier colors, WR badges, count-ups and small motions. No mascots, confetti, slogans or sales copy.
- Play for everything. Its digits are all the same width, so times line up in columns without a second font.
- Corners: `rounded-sm` (4px) for badges, `rounded-md` (8px) for controls and rows, `rounded-lg` (12px) only for padded cards and dialogs.

## Tokens
`web/src/ui/tokens.css` holds every color, type size, radius, shadow and easing as Tailwind theme variables. Tailwind's own palette, radii, type scale and shadows are cleared, so `bg-red-500` or `rounded-3xl` don't compile. Spacing keeps Tailwind's 4px grid.
- Surfaces, darkest to lightest: `bg`, `surface`, `surface-raised`, `surface-overlay`. Borders: `border`, `border-strong`.
- Text: `text`, `text-muted`, `text-subtle`. Accent: `accent`, `accent-hover`, `accent-soft`, `on-accent`.
- Status: `success`, `warning`, `danger`, each with a `-soft` tint. Medals: `gold`, `silver`, `bronze`, `on-medal`.
- Tiers: four ramp stops, `tier-1` (easiest) to `tier-4` (hardest). The tier count is staff data (`domain.md`), so `TierBadge` colors a tier by its position on the ramp, which works for any count.

**Rule:** outside `web/src/ui/`, no raw colors and no arbitrary Tailwind values (`w-[13px]`, `bg-[#fff]`, `[color:red]`). ESLint enforces it (`web/eslint.config.mjs`, tested in `eslint.config.test.ts`). If a page needs something the tokens can't express, add or extend a primitive in `src/ui/`.

## Primitives (`web/src/ui/`)
| Component | Use |
|---|---|
| `Page` | Every page's content area; `width` is `wide`, `narrow` (reading) or `fill` (inside a section layout that sets its own width, such as the staff area). Runs the page fade |
| `Link` | Every internal link; never prefetches. Lint blocks importing `next/link` elsewhere |
| `Button`, `ButtonLink`, `ButtonAnchor` | `primary` (one per view), `secondary` (default), `ghost`; sizes `sm`, `md`. A `ghost` button with `aria-pressed` or `aria-expanded` shows the accent while on. `ButtonAnchor` is for full page loads, such as sign-in |
| `Card`, `Label` | Bordered surface; `interactive` adds the hover lift. `Label` is the small uppercase heading |
| `StatCard` | Headline number with label and icon, counting up, and an optional short detail beside the number (never under it, so cards in a row stay one height). `null` shows a dash |
| `Badge` | Short status: `neutral`, `accent` (WR), `success`, `warning`, `danger` |
| `Medal` | Placement; medals for 1–3, a plain number after |
| `TierBadge` | `tier` and `tierCount` from the API |
| `Avatar` | Steam avatar or initials; `sm` to `xl` |
| `Flag` | Country flag from an ISO code, a grey placeholder without one; `hint` replaces its tooltip |
| `Table` + `TableHead`/`TableBody`/`TableRow`/`TableHeaderCell`/`TableCell` | Leaderboards and staff lists; `numeric` cells right-align, `wrap` cells let long names wrap, a `separated` row starts a group apart. Scrolls sideways inside its frame when too wide |
| `Tabs` | Panels on one page; `underline` or `segmented` |
| `LinkTabs` | Looks like `Tabs`, but each tab is a link: a view the server renders, such as the Maps page's sort |
| `Segmented` | Looks like segmented `Tabs`, for a choice that changes the view in place (a server's activity range, a post's kind). The chosen option is in the accent |
| `ChoiceMenu` | "Label  Value ▾": one choice from a list, in a `Menu` of radio items, changing the view in place, or following each option's `href` on a server page. Boards, profiles and the Maps page use a row of them (Style, Track, Runs; Sort, Records in; lead, 2026-10-26); quiet options are dimmed but choosable, disabled ones dimmed and kept in place. On a phone each takes a full row, label left and value right |
| `ChoiceBar` | The row those menus sit in, with any tabs beside them. Every page uses it, so the spacing between choices stays the same everywhere |
| `Pager` | Previous and next under a paged list |
| `DividedList`, `DividedSection` | Rows with lines between them, and a part set off by a line above, inside a `Card` or `Dialog`. The lines run to the surface's edges |
| `StepChart` | A value that changes in steps over time (WR history). Hover snaps a crosshair to the nearest point; points take focus and open their link |
| `LineChart` | One count over time from zero (players online). Drawn in a fixed box stretched by CSS, so it fills its container before scripts load. Hover, tap or arrow keys pick a point; the parent shows its values. An optional second line (`y2`, gold) shows a part of the first on the same scale (world records among runs). Never two scales on one chart |
| `TierSpread` | How many maps hold each tier: a donut in tier colors beside each tier's count and share; each slice and row links to that tier's maps, the others dim, and "All" closes the list (Maps page) |
| `Tooltip` | Hint on hover and focus; the child must be focusable |
| `Menu`, `MenuItem`, `MenuLink`, `MenuSeparator` | Menu button (account, mobile sections) |
| `Dialog` | Controlled modal (`open`, `onClose`). A field marked `data-autofocus` takes focus on each opening (React's `autoFocus` fires only on mount). Closes itself, without calling `onClose`, when its page is hidden for Back |
| `Input`, `Textarea`, `CountUp` | Text field with optional icon; multi-line field; animated number |
| `Prose` | Long-form HTML (a post's body) in the site's type. Only for HTML the API made safe |

The run dialog opens in place: `RunLink` adds `?run=<id>` to the address with `history.pushState`, and `RunDialogHost` (in the root layout) opens at once and loads the run inside. Back or Escape closes it, and the address can be shared. A run link's `href` is `/runs/{id}`, the run's own page, for new tabs. A map page's style and track work the same way, with `replaceState`.

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
- `HeaderDepth` (`features/home/`): the home header's picture leans with the mouse, by a depth map of it (`scripts/header-depth.py`; rerun it when the picture changes). Dust drifts in the light shaft, and a click sends cyan traces crawling over the surfaces (`headerTraces.ts`). WebGL, running only while the header is on screen; off on touch screens and with reduced motion.
- `motion-ripple`: a ring spreading and fading from where something landed; re-key it to replay.
- `motion-pop`: a popover menu fading in with a slight drop and grow, and fading out as it closes (`Menu`).
- `CountUp`: counts up when scrolled into view, and from the old value when it changes. A number already in view when the page loads stays as it is.
- `page-fade`: between pages (see Navigation).

All of them respect `prefers-reduced-motion` and show their end state at once.

## Navigation
Pages swap in place with no full page load. The old page fades out quickly and the new one fades in, using React's `<ViewTransition>` in `Page` and the `page-fade` rules in `motion.css`. The header has its own view-transition name, so it stays still during the fade. Browsers without view transitions swap pages without the fade. A page with views, such as a map and its Manage view, keeps its header in a route layout and wraps each view in `PageView`: switching views fades the old one out and lifts the new one in (`view-flip`), and the header stays.

Links never prefetch, whether in view or hovered (lead's choice, 2026-10-19). A page loads only once it's opened, and the fade covers the wait. `e2e/navigation.e2e.ts` checks that following a link doesn't reload the page.

## Layout shell (`web/src/features/site/`)
Header (wordmark, sections, account corner) and footer, applied in the root layout. On narrow screens the sections collapse into a menu. The account corner (sign-in button, or the player's menu) and the current-section highlight depend on the request, so each sits in `<Suspense>` and every page's shell stays static. Search lives on the Players page. Section pages arrive with their roadmap slices.

## Screenshot tests
`npm run test:ui` (part of `just check`) screenshots `/dev/ui` wide, on a phone, with the menu open and with the dialog open, and fails on any pixel change. After an intended visual change:
```
cd web && npx playwright test --update-snapshots=all
```
Review the new PNGs in `web/e2e/style-guide.e2e.ts-snapshots/` and commit them with the change. Playwright uses the system Chrome (`channel: "chrome"`) and reuses a running dev server. Baselines are rendered on Linux; another platform needs its own.
