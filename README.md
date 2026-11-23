# BusinessSim

A top-down 2D business tycoon game for Windows. You start nearly broke with one tiny shop, and grow into a city-wide empire of nine kinds of business, watched over by a few hundred simulated customers who walk in, browse, queue, buy, complain and leave.

Built with TypeScript, Phaser 3, Vite and Electron. All art and sound is generated in code, so the game has no asset files.

**Version 1.0.0.** See [CHANGELOG.md](CHANGELOG.md) for what each milestone added.

## Download and install

1. Go to the [latest release](https://github.com/NoVanity99/BusinessSim/releases/latest).
2. Download **`BusinessSim-Setup-<version>.exe`** and run it.
3. Windows SmartScreen will say "Windows protected your PC", because the build is not code-signed yet. Click **More info**, then **Run anyway**.
4. Choose where to install. The installer adds desktop and Start Menu shortcuts and an uninstaller. Nothing else needs to be installed.

There is also **`BusinessSim-Portable-<version>.exe`**, a single file that runs without installing. The portable version does not update itself: it tells you when a new version is out and opens the download page.

Saves and settings live in `%APPDATA%\BusinessSim` and survive updates and uninstalling.

### Updates

The installed game looks for a new release a few seconds after the main menu appears, and again every four hours while it runs. It never interrupts play.

- On the main menu a notice shows **Update available: vX.Y.Z** with **View changes** (the release notes) and **Download**, then a progress bar.
- When the download is done, choose **Restart to update** (your game is autosaved first) or **Later**, which installs it the next time you quit.
- If an update is found while you are playing, you only get a small toast.
- **Settings** shows the installed version, a **Check for updates** button, and a **Download updates automatically** toggle (on by default; with it on, the download starts by itself and you are only asked about restarting).
- With no internet, or if GitHub is unreachable, you get a short message and carry on playing.
- Updater activity is logged to `%APPDATA%\BusinessSim\logs\updater.log`.
- Development runs (`npm run dev`, `npm start`) never check for updates.

## Playing

A checklist in the game walks you through your first shop. The short version:

1. Click a lot with a yellow outline and rent it. Quiet neighbourhoods are cheap.
2. Open a Convenience Store on it.
3. In the Build tab, place a shelf and a checkout. `R` rotates.
4. In the Stock tab, order a few cases.
5. When the delivery arrives, click the shelf, choose products and fill it.
6. Unpause. You run the first checkout yourself; hire staff as you grow.

### Businesses

| Business | Unlocks | What makes it different |
| --- | --- | --- |
| Convenience store | Level 1 | Shelves, fridges, freezers and a checkout |
| Coffee shop & bakery | Level 2 | Made-to-order drinks, an oven baking fresh batches, decor raises prices |
| Laundromat | Level 2 | Wash and dry cycles paid at the machine; breakdowns |
| Vending machine business | Level 2 | Machines on any pavement in the city; a van round restocks and collects |
| Fast food restaurant | Level 3 | Order counter, kitchen queue, cooks, impatient customers |
| Card & collectibles shop | Level 3 | Open packs for volatile singles; collectors; tournaments |
| Gas station | Level 4 | Cars pull in for fuel, a mini-mart, a car wash and a repair bay |
| Workshop / factory | Level 4 | Recipes turn ingredients into house brands to sell or ship to your shops |
| Fun park | Level 5 | Ticket gate, attractions, guest happiness |

### Controls

| Input | Action |
| --- | --- |
| Drag, `WASD`, arrow keys | Move the camera |
| Mouse wheel, `=` / `-` | Zoom |
| `Space`, `1` / `2` / `3` | Pause; speed 1x / 2x / 4x |
| Left click | Select a person, a lot, a piece of furniture or a vending machine |
| `B` / `F` / `T` | Businesses, finances and staff windows |
| `R` | Rotate furniture while building |
| `Esc` | Back out one step; with nothing selected, open the pause menu |
| `F5` | Quick save to slot 1 |
| `F11` | Fullscreen |

In build mode, left click places and drag paints floors and walls; right click puts the tool away; pan with the middle or right mouse button. Every key except `F11` can be rebound in Settings.

### Saves

Five manual slots plus an autosave at 06:00 each game day.

- Desktop: `%APPDATA%\BusinessSim\saves\*.json`
- Browser dev mode: `localStorage` keys prefixed `businesssim:`

## Releasing a new version

Releases are built by GitHub Actions (`.github/workflows/release.yml`) whenever a tag like `v1.0.1` is pushed. The version in `package.json` must match the tag, and the workflow stops with a clear error if it does not.

One command bumps the version, commits, tags and pushes:

```bash
npm run release
```

That is a patch bump (1.0.0 to 1.0.1). For anything else:

```bash
npm run release -- minor
```

```bash
npm run release -- 2.0.0
```

For the very first release, tag the version that is already in `package.json` without bumping it:

```bash
npm run release -- current
```

What happens next, in about five minutes:

1. The workflow checks the tag against `package.json`, runs `npm ci` and builds the game.
2. It creates a draft release with notes generated from the commits since the previous tag.
3. `electron-builder --publish always` uploads the installer, its `.blockmap`, `latest.yml` and the portable exe, using the built-in `GITHUB_TOKEN`.
4. It checks all four files are there, then publishes the release and marks it latest.

Installed copies of the game find it on their next check. `latest.yml` and the `.blockmap` are what the updater reads, so do not delete them from a release. To edit the notes players see under "View changes", edit the release description on GitHub.

Doing it by hand instead of `npm run release`: change `version` in `package.json`, run `npm install` to update the lockfile, commit, then `git tag v<version>` and push the branch and the tag.

If a release build fails, fix the problem, delete the tag and the draft release on GitHub, and release again.

### Code signing

Builds are unsigned, so SmartScreen warns on first run and on each new version until enough people have run it. Signing removes that. The configuration is in place but switched off: `electron-builder.yml` has the commented steps, and `release.yml` has two commented `CSC_` lines to enable once you have a certificate and have added it as repository secrets.

### The icon

`build/icon.ico` is a generated placeholder (`npm run icon` recreates it from `scripts/make-icon.mjs`). Replace the file with your own multi-size `.ico` that includes a 256x256 image.

## Building

Needs Node.js 20 or newer.

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Run in the browser at http://localhost:5173 with hot reload |
| `npm run dev:electron` | Run in the Electron window with hot reload |
| `npm run build` | Type-check and build to `dist/` and `dist-electron/` |
| `npm start` | Build and launch the desktop app |
| `npm run dist:win` | Build the Windows installer and portable `.exe` into `release/`, without publishing |
| `npm run dist:win:portable` | Build only the portable `.exe` |
| `npm run release` | Bump the version, tag and push, which publishes a GitHub release |
| `npm run icon` | Regenerate the placeholder icon |

To build the Windows executables on a Windows PC:

```bash
npm install
```

```bash
npm run dist:win
```

For a test build without releasing, GitHub Actions (`.github/workflows/build-windows.yml`) does the same on a Windows runner for every push to `main` and to `claude/**` branches. Download the files from the run's **Artifacts** section. Builds made this way can check for updates like any other, but only tagged releases are published for players.

From Linux or macOS, `npm run dist:win:portable` cross-builds the portable `.exe` (without the icon embedded, which needs Windows or Wine). The installer also needs Wine, so use a Windows machine or the Actions build for that.

## Changing the game

Almost everything is data. Edit the JSON in `src/data/` and rebuild.

| File | Contains |
| --- | --- |
| `shops.json` | Business types: flow, furniture, products, roles, licence cost, unlock level, demand |
| `products.json` | Goods, menu items, ingredients, services and recipes with prices |
| `furniture.json` | Floors, walls, shelves, machines, attractions: size, cost, capacity, breakdown rate |
| `employees.json` | Roles, wages, traits |
| `upgrades.json` | Per-shop and company-wide upgrades |
| `events.json` | Loans, holidays, event chances, XP curve |
| `neighborhoods.json`, `city.json` | Districts and the city layout |
| `population.json` | Crowd size by hour, budgets, patience, road traffic |
| `economy.json`, `difficulty.json` | Wholesale terms, utilities, difficulty settings |

A new product or piece of furniture only needs a JSON entry. A new business type needs an entry in `shops.json` using one of the existing flows (`retail`, `counter`, `service`, `park`, `depot`, `factory`); a genuinely new flow needs code in `src/systems/ai/customers.ts`.

### Replacing the placeholder art

- **Furniture**: preload an image under the texture key `furn_<furniture id>` before the city scene starts and the procedural painter in `src/art/sprites.ts` is skipped. Draw it facing south, sized footprint × 32 px.
- **People and cars**: texture keys `npc_0` to `npc_23`, `staff_<role>`, `car_0` to `car_5` and `car_99` (the van), created in `src/scenes/city/NpcViews.ts`.
- **Ground and buildings**: `drawTile` and `drawBuilding` in `src/art/cityArt.ts`.
- **Sound**: the `SFX` table and `music` object in `src/systems/audio/audio.ts`.

## Project layout

```
electron/            Electron main process, preload bridge and updater
scripts/             Release helper and icon generator
src/main.ts          Phaser config and scene list
src/scenes/          Boot, menu and city scenes; city/ holds the build tool and world renderers
src/systems/
  ai/                Walk grid, A* pathfinding, customer brain, road vehicles
  build/             Placing and selling furniture, walls and floors
  city/              City generator
  economy/           Finance ledger, market prices, stock and orders, property, loans, transfers, net worth
  events/            Random events, rivals, news
  progress/          Levels and upgrades
  save/              Storage backend, save slots, autosave
  shop/              Opening hours, kitchens, production, pricing, cards, vending
  staff/             Hiring, shifts, morale, on-site behaviour, manager reordering
  time/              Game clock
  update/            In-game view of the updater
  audio/             Synthesised sound and music
src/entities/        Plain data types: shop, customer, employee
src/data/            JSON definitions and their TypeScript types
src/ui/              HTML interface: HUD, panels, windows, menus, charts
src/art/             Procedural art
src/core/            Shared state, event bus, settings, input, utilities
```

Game state is plain JSON (`src/core/state.ts`), kept separate from rendering, which is what makes saving simple.

## Testing and known limits

- Developed on Linux. The game was exercised by scripted playthroughs in Chromium and in the Electron app on Linux, including saving and loading through the real file bridge. The Windows executables are built and uploaded by GitHub Actions, but nobody has yet played them on a Windows machine.
- The updater's interface was tested against a simulated update, and its real code was run in a packaged Linux build against this repository (where it correctly reported that no releases exist yet). A real download and install on Windows has not been done; follow the test release steps to confirm it.
- Sound has not been checked by ear.
- Balance is a first pass, tuned from single-day simulated runs of each business. Expect to adjust the numbers in `src/data/`.
- Pedestrians and cars in transit are not saved; the streets repopulate when a game loads.
- `window.__dbg` in the developer console exposes helpers for testing, such as `__dbg.addXp(__dbg.session.state, 5000)` and `__dbg.session.state.money += 50000`.
