# M49 Phones: the plan

SPEC-6.md M49, done after M42 and before M43. Measure first, log the numbers, then fix what they show.

## 0. Measure (logged in PROGRESS "Performance (M49)")
- First load's download: the built `dist/` as Pages serves it, gzipped (index, JS chunks, the models
  file, the demo town), first visit and second visit (service worker cache).
- Memory: `performance.measureUserAgentSpecificMemory()` where available (cross-origin isolated
  only), else `performance.memory.usedJSHeapSize` plus three's renderer info (geometries, textures)
  and the GPU buffer bytes we already count (`bufprobe.mjs`): the demo town, a 20k city, the 110k
  bench city, each at Low and at the new Phone preset.
- Frame and tick times under Playwright's phone emulation (iPhone 13, Pixel 7) with CDP CPU
  throttling (4×), at Low and Phone: average and 95th-percentile frame interval (`recordFrames`),
  draw calls and triangles, the worker's tick times.

## 1. Touch controls
- One finger pans (exists), pinch zooms (exists), two fingers turn and tilt (twist and two-finger
  vertical drag).
- Tap selects or places (clickOnly tools exist: P-fixes). Drag draws roads, zones, areas; on touch
  a road or zone stroke ends in a confirm bar (cost, Confirm, Cancel) before money is spent.
- Long press (500 ms, little movement) opens the inspector at that spot and shows the tool's hint
  where desktop would show a tooltip; toolbar buttons' tooltips on long press.
- Undo one tap away (the bottom bar's undo, always visible on a phone).
- Hit targets 44 px on phones (`#ui[data-width='xs']`, coarse pointer).

## 2. Layout
- Upright and sideways (`data-width` and a new `data-orient`).
- The toolbar as a bottom bar the thumb reaches: the main tools in one row, groups (services,
  utilities, transit…) opening as sheets above it.
- Panels as bottom sheets on phones (slide up, drag the handle down to close).
- Safe areas (`env(safe-area-inset-*)`, `viewport-fit=cover`).
- Readable text at the phone's default size (no smaller than 12 px CSS).
- Every panel checked in phone emulation, upright and sideways; the map editor says plainly it needs
  a bigger screen if it can't work.

## 3. Graphics
- A Phone preset below Low: render resolution capped, no shadows, near draw distance, fewer trees,
  cars and walkers, simpler water and effects; the same bright look.
- A 30 fps cap on by default for phones, a battery saver setting (30 fps, Phone preset, lower
  resolution).
- The first-launch check recognises phones and tablets (coarse pointer, small screen, UA) and picks
  the preset that holds.

## 4. Memory, battery, data
- A measured memory budget for a phone; warn before opening a city too big for the device.
- Model batches loaded as needed (war models already are); free what's off screen.
- Stop drawing in the background (exists via rAF?) and when nothing moves (drop to a low rate).
- Show the first download's size; cache everything (the service worker exists); optional extras
  (music, war models) only when needed.
- Crash reports from phones (M41) where the browser allows (a `pagehide` marker, a report next visit).

## 5. Installing on a phone
- The manifest and icons for full screen and a splash; iPhone's apple-touch-icon and status bar.
- Ask to keep saves; on iPhone, suggest an export now and then; export and import through the share
  sheet (`navigator.share` with a file) and Files.

## 6. Slow phones in shared cities
- A joiner catching up: the room waits for a joiner within a limit, and the worker's catch-up runs
  in budgeted slices so the page keeps drawing; test with a throttled phone page joining a busy city.

## 7. Tests
- e2e in phone emulation (iPhone and Android profiles, touch): a town from the main menu by touch
  alone, upright and sideways (roads, zones, power, water, a service, the budget, the inspector by long
  press, undo, saving and loading).
- A throttled phone page joins a busy shared city and catches up.
- The Phone preset holds its frame target on the bench city under throttling.
- Memory inside its budget on the 20k city.
- Pictures of every panel upright and sideways, reviewed.
