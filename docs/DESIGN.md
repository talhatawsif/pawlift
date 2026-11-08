# PawLift design (read this only for styling)
Trustworthy like Uber, friendly like a pet shop. Phone-first for everyone; desktop = same layout in a centred, wider column (max-w-lg/xl). System font. Palette in `globals.css` (brand green, urgent amber, danger red, warm off-white). BRIEF §3.2 "never" list still applies.

## Type scale (Tailwind)
Page title `text-3xl font-semibold` · section `text-xl font-semibold` · card title `text-lg font-semibold` · body `text-base` · secondary `text-sm text-muted` · chip `text-xs font-semibold`. Line height tight on titles, default on body.

## Spacing and shape
4/8 px rhythm: card padding `p-4`, gap between card parts `gap-4`, list gap `gap-3`, section gap `mb-6`. Side gutter 16 px.
Radii: cards and tiles 16 px (`rounded-2xl`), buttons 14 px, inputs `rounded-xl`, chips full.
Shadow: one soft shadow, `var(--shadow-soft)`; use `.card` for surfaces. No heavy `shadow-md`.

## Buttons (classes in `globals.css`)
- `.btn-primary`: one filled brand button per screen, the main action. 
- `.btn-secondary`: outlined brand, secondary action.
- `.btn-text`: text only, cancel or low-emphasis.
All have `min-height` 48 px. Pair with `h-12`, `w-full` or `flex items-center justify-center` for links. Disabled: `disabled:opacity-60`.

## Chips
`.chip`: pill, muted on warm background. Urgent: add `!bg-urgent/10 !text-urgent-strong`. DEMO badge stays amber.

## Cards
`.card` + `p-4`: avatar or photo left (72 px), then title, route (`A → B`), distance or time, chips. Selected: `!border-brand !bg-brand/5`.

## Touch and motion
Every tappable target at least 48 px tall (compact selects may be 40 px). Transitions 120 to 150 ms, never over 200 ms; reduced motion switches them off. Visible `:focus-visible` ring stays.

## Species avatar (no photo, the common case)
`SpeciesAvatar` (`src/components/SpeciesAvatar.tsx`): rounded 72 px tile (56 px in dense lists), soft warm tint `--tile` with `--tile-ink` silhouette; filled cat, dog and paw (other). Never amber, because amber means urgent. Decorative, `aria-hidden`. Use it wherever a photo would appear. Real photos stay as rounded photos (`rounded-2xl object-cover`, same size).

## Copy
Warm, one line, Australian English, "lift" wording. Empty and success states say something kind, not "No data".
