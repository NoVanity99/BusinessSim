# BusinessSim

A top-down 2D business tycoon game for Windows. You start nearly broke with one tiny shop and grow into a city-wide empire of 23 kinds of business, in a city of 420 residents who each have needs, tastes, a budget and a memory of how you treated them, alongside three rival companies after the same customers.

Built with TypeScript, Phaser 3, Vite and Electron. The art is 32×32 pixel art built on Kenney's CC0 packs, with the gaps drawn in code to match; all sound is synthesised.

**Version 2.0.0.** See [CHANGELOG.md](CHANGELOG.md) for what each step added.

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
| Coffee shop & bakery | Level 2 | Made-to-order drinks, an oven baking fresh batches, decor matters |
| Laundromat | Level 2 | Wash and dry cycles paid at the machine; breakdowns |
| Vending machine business | Level 2 | Machines on any pavement in the city; a van round restocks and collects |
| Fast food restaurant | Level 3 | Order counter, kitchen queue, cooks, impatient customers |
| Card & collectibles shop | Level 3 | Open packs for volatile singles; collectors; tournaments |
| Drug store | Level 3 | Medicines and toiletries; cold remedies in winter, sunscreen in summer |
| Bookstore | Level 3 | Browsers who like a pleasant shop |
| Gas station | Level 4 | Cars pull in for fuel, a mini-mart, a car wash and a repair bay |
| Workshop / factory | Level 4 | Makes goods, ingredients and clothes for less than they cost to buy |
| Warehouse | Level 4 | Cheaper bulk orders; vans that keep your shops stocked |
| Clothing store | Level 4 | High margins and strong seasons |
| Pizza place | Level 4 | One pizza per oven at a time |
| Fun park | Level 5 | Ticket gate, attractions, guest happiness |
| Pet shop | Level 5 | Regulars matter most |
| Arcade | Level 5 | Cabinets, pinball and air hockey paid per game |
| Electronics store | Level 6 | Expensive stock and a favourite of thieves |
| Gym | Level 6 | Sessions and classes; busy before and after work |
| Food truck business | Level 6 | Trucks parked on any pavement; busiest at mealtimes |
| Bar and nightclub | Level 7 | Open into the small hours; a dance floor keeps guests paying |
| Movie theater | Level 8 | Eighteen seats a screen, concessions on the way in |
| Hotel | Level 9 | Rooms by the night, mostly for visitors |
| Car dealership | Level 10 | A few sales a day worth thousands each |

### What else there is to do

- **Staff**: eight roles that work down a task list you can reorder per shop, take breaks, and can be poached by rivals. Drag shifts on a timeline in the Staff screen.
- **Customers**: click anyone to see their persona, needs, plans and what they think of your shops. They compare your prices, reputation and distance with rival shops, become regulars, tell their friends and post reviews.
- **Rivals**: three companies that open shops, start price wars, hold sales and close when they lose. Buy them out, or out-compete them.
- **Thieves**: visible shoplifters; guards chase them, cameras help, insurance pays.
- **Seasons, weather and holidays** change who is out and what they want.
- **Marketing**: eight campaigns from flyers to TV.
- **Logistics**: warehouses, your own delivery vans, supplier contracts, and factories that feed your shops.
- **Franchising**: other people open shops under your brand and pay royalties.
- **Property**: a market that moves, tenants, buying low and selling high.
- **Finance**: loans, investors, weekly tax, insurance, and a chart of your worth against the rivals'.
- **You**: energy, a home and a car, and visiting your shops in person.
- **Goals**: 22 achievements, delivery orders, six scenarios with deadlines, and a sandbox.
- **Photo mode** and ten save slots with pictures.

### Controls

| Input | Action |
| --- | --- |
| Drag, `WASD`, arrow keys | Move the camera |
| Mouse wheel, `=` / `-` | Zoom |
| Click or drag on the minimap | Jump the camera there |
| `Space`, `1` / `2` / `3` | Pause; speed 1x / 2x / 4x |
| Left click | Select a person, a lot, a piece of furniture, a rival shop or a vending machine |
| `B` / `F` / `T` / `K` | Businesses, finances, staff and stock windows |
| `N` / `M` | Notifications; show or hide the minimap |
| `R` | Rotate furniture while building |
| `C` | Copy tool while building |
| `Ctrl+Z` / `Ctrl+Y` | Undo and redo building |
| `P` | Photo mode (`Enter` takes the picture) |
| `F1` | Controls and help |
| `Esc` | Back out one step; with nothing selected, open the pause menu |
| `F5` | Quick save to slot 1 |
| `F11` | Fullscreen |

In build mode, left click places one piece and dragging lays out a row or paints floors and walls; right click puts the tool away; pan with the middle or right mouse button. The keys in the first column of the help window can be rebound in Settings, which also has the interface size, colour-blind colours and graphics quality.

### Saves

Ten manual slots, each with a picture of the city, plus an autosave at 06:00 each game day.

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

You can also release without touching git: on GitHub open **Actions > Release > Run workflow**, pick the branch, and run it. It releases whatever version is in `package.json` on that branch and creates the tag itself. It refuses if that version is already published.

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
| `npm test` | Run the logic tests: save migration and a headless simulation of every business |
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

### Changing the art

The game is clean 32×32 pixel art, authored at 16 px per tile and drawn at 2×. All world art is packed into one texture atlas when the game starts (`src/art/atlas.ts`), from two sources:

- Tiles cut from Kenney's CC0 packs in `art-src/kenney/` (see [CREDITS.md](CREDITS.md)).
- Sprites painted in code in the same style, for everything the packs do not cover.

| To change | Edit |
| --- | --- |
| Ground, streets, roofs, building fronts | `src/art/worldArt.ts` (which tiles and recolours), `src/art/cityArt.ts` (how the city is laid out from them) |
| Furniture, machines, floors, walls, doors | `src/art/furnitureArt.ts`: one painter per `sprite` id in `furniture.json`, drawn once per facing, plus animation frames |
| People and cars | `src/art/actorArt.ts` |

To use your own image for a sprite, load it in `BootScene.preload()` and blit it inside the painter registered under the same frame name; nothing else needs to know. A new piece of furniture with no painter still appears, as a plain crate in its data colour.

- **Sound**: the `SFX` table and `music` object in `src/systems/audio/audio.ts`.

## Project layout

```
electron/            Electron main process, preload bridge and updater
scripts/             Release helper and icon generator
src/main.ts          Phaser config and scene list
src/scenes/          Boot, menu and city scenes; city/ holds the build tool and world renderers
src/systems/
  ai/                Walk grid, A* pathfinding, residents, customer brain (and shoplifters), road vehicles
  build/             Placing and selling furniture, walls and floors
  city/              City generator
  economy/           Finance ledger, market prices, stock and orders, property, loans, transfers, net worth
  events/            Random events, news, when thieves turn up
  rivals/            Rival companies: their shops, pricing, expansion and staff poaching
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

### Changing what gets saved

Saves have a format number. If you add, rename or reshape anything in `GameState`, add one step to `src/systems/save/migrations.ts` that upgrades the previous format, and extend `tests/save.test.ts`. Never edit a step that has shipped. The test suite loads a real 1.0.0 save (`tests/fixtures/save-v1.json`) on every run, so breaking old saves fails the build.

Art credits are in [CREDITS.md](CREDITS.md).

## Testing and known limits

- `npm test` runs about sixty headless tests of the simulation: every business opening and trading from its starter layout, saves from 1.0.0 loading, staff, rivals, thieves, deliveries, contracts, franchises, tax, scenarios and more. `npm run balance` prints takings, costs and payback for every business (it takes a couple of minutes).
- Developed on Linux. The game was exercised by scripted playthroughs in Chromium and in the Electron app on Linux, including saving and loading through the real file bridge. The Windows executables are built by GitHub Actions; they have not been played through on Windows as part of development.
- Frame rate was profiled without a graphics card: with 420 people on the streets the game's own work is well under a millisecond a frame, and the software renderer used for testing reaches about 40 frames a second. A real graphics card should hold 60, but that was not measured. If the game feels slow, lower Graphics quality in Settings.
- The updater's interface was tested against a simulated update, and its real code was run in a packaged Linux build against this repository. Updating an installed 1.0.0 to 2.0.0 on Windows has not been done in development.
- Sound has not been checked by ear.
- Balance was tuned from averaged multi-day simulated runs of each business on its own. A whole career played by a person will find things those runs did not; the numbers are all in `src/data/`.
- One test (`every business type opens and takes money`) failed once during development and could not be reproduced in many later runs; the cause was not found.
- Pedestrians and cars in transit are not saved; the streets repopulate when a game loads.
- `window.__dbg` in the developer console exposes helpers for testing, such as `__dbg.addXp(__dbg.session.state, 5000)` and `__dbg.session.state.money += 50000`.
