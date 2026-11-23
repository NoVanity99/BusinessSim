# BusinessSim

A top-down 2D business tycoon game for Windows. You start nearly broke with one tiny shop, and grow into a city-wide empire of nine kinds of business, watched over by a few hundred simulated customers who walk in, browse, queue, buy, complain and leave.

Built with TypeScript, Phaser 3, Vite and Electron. All art and sound is generated in code, so the game has no asset files.

**Version 1.0.0.** See [CHANGELOG.md](CHANGELOG.md) for what each milestone added.

## Playing

Run `BusinessSim-Portable-<version>.exe`, or install with `BusinessSim-Setup-<version>.exe`. Nothing else needs to be installed. The files are unsigned, so Windows SmartScreen warns on first run: choose "More info", then "Run anyway".

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

## Building

Needs Node.js 20 or newer.

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Run in the browser at http://localhost:5173 with hot reload |
| `npm run dev:electron` | Run in the Electron window with hot reload |
| `npm run build` | Type-check and build to `dist/` and `dist-electron/` |
| `npm start` | Build and launch the desktop app |
| `npm run dist:win` | Build the Windows installer and portable `.exe` into `release/` |
| `npm run dist:win:portable` | Build only the portable `.exe` |

To build the Windows executables on a Windows PC:

```bash
npm install
```

```bash
npm run dist:win
```

GitHub Actions (`.github/workflows/build-windows.yml`) does the same on a Windows runner for every push to `main`, to `claude/**` branches, and for `v*` tags. Download both files from the run's **Artifacts** section.

From Linux or macOS, `npm run dist:win:portable` cross-builds the portable `.exe`. The installer needs a working Wine, so use a Windows machine or the Actions build for that.

To give the `.exe` a custom icon and version info, put `icon.ico` (256x256) in `build/`, set `signAndEditExecutable: true` in `electron-builder.yml`, and build on Windows.

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
electron/            Electron main process and preload (window, save-file bridge)
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
- Sound has not been checked by ear.
- Balance is a first pass, tuned from single-day simulated runs of each business. Expect to adjust the numbers in `src/data/`.
- Pedestrians and cars in transit are not saved; the streets repopulate when a game loads.
- `window.__dbg` in the developer console exposes helpers for testing, such as `__dbg.addXp(__dbg.session.state, 5000)` and `__dbg.session.state.money += 50000`.
