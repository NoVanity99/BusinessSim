# Changelog

## 1.3.0 (unreleased) - Overhaul phase 2: characters and atmosphere

- **72 distinct people** made by recolouring the pack's six characters (five skin tones, seven hair colours, nine tops, six trousers), including children drawn smaller and grey-haired seniors. Each has a walk cycle in four directions and a soft shadow.
- **Emotes** over people's heads show what is going on at a glance: happy, angry, waiting, carrying a bag, eating. People who sit are drawn on the seat.
- **Day and night**: a darkness layer in dusk purple and night blue, with every light source cutting a soft pool out of it: street lamps that switch on at dusk, lit windows (fewer in the small hours), open shops, lamps and vending machines you place, car headlights, traffic signals.
- **Weather**, saved with the game: sunny, cloudy, rain, fog, snow and heatwaves, with rain and snow particles, fog, and a grey cast. Weather changes how many people are out, which businesses they want (cafés fill up in the rain, the park empties) and what they buy (ice cream in a heatwave, tea in the snow). Defined in `src/data/weather.json`.
- **A livelier city**: traffic lights that cars actually obey, cars that keep a gap behind the one in front, drivers who pull over and park for a while, buses, lamp posts, hydrants, mailboxes and benches, trees that sway, birds crossing the sky.
- **Effects**: coins and sparkles at the till on every sale, steam from coffee machines, smoke from grills and fryers, dust when you build, spray from the car wash.
- **Camera**: zoom eases smoothly toward the cursor; scenes fade in and out.
- **Performance**: sprites are pooled and reused, anything off screen is hidden and skipped, and shadows are part of the sprite. New **Graphics quality** setting (Low, Medium, High) controls lighting, particles and weather density.
- Save format 3 (adds weather). Older saves upgrade automatically.

## 1.2.0 (unreleased) - Overhaul phase 1: art pipeline and world

The game is now pixel art: 32×32 tiles in one consistent style, built on Kenney's CC0 "RPG Urban Pack" and "Roguelike Indoors" with everything else drawn in code to match.

- **Texture atlas**: all world art is packed into a single texture at startup, so the renderer draws it in a few batches. Tiles are authored at 16 px and shown at 2× with crisp nearest-neighbour scaling.
- **City**: tiled streets with kerbs, lane markings and zebra crossings, pavements, grass, trees, sand and water; other buildings have tiled roofs recoloured per neighbourhood and, where they face the camera, a front wall with a door and windows.
- **Every object has a sprite**, drawn for each of its four facings so you can see which side customers use: shelves, racks, fridges, freezers, display cases, checkouts, order counters, grills, fryers, drinks and espresso machines, ovens, washers, dryers, benches, tables, play tables, vats, bottling lines, fuel pumps, tanks, car washes, repair bays, vending machines, gates, slides, pools, carousels, bumper cars, arcade cabinets, stalls, fountains, plants, lamps, rugs and bins.
- **Goods are visible**: each shelf section shows packs in the product's colour, fewer as it sells down, and a red tag when it is empty.
- **Machines animate while in use**: washer and dryer drums turn, ovens glow, vats stir, bottles move along the line, carousels spin, pool water ripples.
- **Interiors are open to view**: shops have low block walls and no roof, so everything inside is visible at any zoom.
- **People and cars** use the pack's characters and vehicles: six characters with walk cycles in four directions, cars with four drawn views in six colours. Staff carry a small badge in their role colour. (Full character variety comes in phase 2.)
- Broken machines show an out-of-order badge; dirty shops show litter; producers show a progress bar.

## 1.1.0 (unreleased) - Overhaul phase 0: foundations

First step of the 2.0 overhaul. Nothing looks different yet; this makes the later phases safe.

- **Save versioning**: saves carry a format number (now 2) and the game version that wrote them. Older saves are upgraded step by step through `src/systems/save/migrations.ts`, and the untouched original is kept as a backup before upgrading. A save from a newer game is refused with a clear message instead of being loaded wrongly.
- **Tests** (`npm test`): a real save written by the released 1.0.0 build is loaded, upgraded and played through a midnight; every business type is opened and must take money; game data is checked for dangling references. They run without a browser in about two seconds, and in CI before every build and release.
- Each shop now keeps up to 120 days of daily history (customers, revenue, costs), ready for the dashboards.
- The simulation is self-contained (`stepSimulation`, `installSim`): the rendering scene no longer owns any game logic, which is what lets the tests run it headless.
- Art sources for the graphics overhaul added under `art-src/kenney/` (CC0), with `CREDITS.md`.

## 1.0.0 follow-up - GitHub releases and in-game updater

- Windows installer (NSIS) is now the main download: choose the install folder, desktop and Start Menu shortcuts, uninstaller, app icon. The portable exe remains as a secondary download.
- `release.yml` workflow: pushing a `v*` tag builds and publishes a GitHub release with the installer, portable exe, `latest.yml` and blockmaps, with generated release notes. It fails early if the tag and `package.json` version differ.
- `npm run release` bumps the version, commits, tags and pushes in one step.
- In-game updater (electron-updater): background check after the main menu loads and every four hours; main-menu notice with release notes, download progress (percent, speed, size), and Restart to update or Later (installs on quit); a toast only during play; autosave before restarting; version, manual check and auto-download toggle in Settings; friendly errors; log file in AppData; disabled in development.
- Placeholder app icon generated by `npm run icon`.
- Code-signing configuration prepared but disabled.
- Phaser moved to dev dependencies (it is bundled by Vite), so the packaged app no longer ships a second copy.

## 1.0.0 - Milestone 9: balance, polish and performance

- Balance pass from full-day simulated runs of all nine businesses: more people on the street, demand shared more evenly between business types, word of mouth brings shoppers from across town, parks and card shops act as destinations, lower rents in the busiest districts, and machine breakdowns cut to roughly one every few days instead of several a day.
- Gas stations: each passing car decides once per trip; fuel margin and traffic retuned.
- Performance: the simulation costs about 0.05 ms a frame at 1x and 0.14 ms at 4x with 320 pedestrians (measured), and spawning is capped at three path searches a frame.
- Getting-started checklist that follows your progress through the first shop.
- The Overview tab flags prices that are far below or far above what customers would pay.
- Litter appears on the floor as a shop gets dirty; footsteps when zoomed in close.
- End-to-end test of the Electron app: new game, play, save to disk, quit to menu, continue.

## 0.8.0 - Milestone 8: events, progression, upgrades, loans, rivals

- Player level and XP from serving customers, sales, opening businesses and surviving days. Business types unlock at levels 1 to 5; the top bar shows level and average reputation.
- Upgrades (`src/data/upgrades.json`): per-shop (faster tills, self-checkout, back-room shelving, service contract, energy efficiency, local advertising, security cameras, kitchen upgrade) and company-wide (supplier contract, priority logistics).
- Bank loans in three sizes with daily interest and repayments, early repayment, and overdraft interest. Debt counts against net worth.
- Events (`src/data/events.json`): recurring holidays that swell the crowds, rivals opening near your shops, viral reviews good and bad, supply shortages that move prices, health inspections with fines for dirty food businesses, shoplifters (deterred by guards and cameras), and staff with sticky fingers skimming the till.
- News window with active events and a log; Company window with level, goal, company upgrades and the bank.
- Map overlays for foot traffic, cleanliness and customer happiness, each with a legend.
- Reaching the net-worth goal shows a win screen and lets you keep playing; hitting the bankruptcy limit ends the game.

## 0.7.0 - Milestone 7: eight more business types

Customers now follow a visit plan (buy from shelves, order at a counter, use a machine or attraction, pay), so every business shares one AI.

- **Coffee shop & bakery**: made-to-order drinks from an espresso machine, an oven that bakes dough into fresh pastries in batches, and decor that raises the prices people accept.
- **Laundromat**: washers and dryers with cycle times, paid at the machine with no checkout needed; benches for waiting; machines break down and need repair.
- **Fast food restaurant**: order counter, grill, fryer and drinks machine; orders go to a kitchen queue worked by cooks; customers wait for their food and walk out if it is slow; seating.
- **Card & collectibles shop**: sealed packs and accessories, a display case for singles in three rarities with volatile prices, pack opening, collector customers, play tables and bookable tournaments with entry fees.
- **Gas station**: an open forecourt with pumps and a fuel tank, cars that pull in from the road, an attached mini-mart, a car wash, and a repair bay that needs a mechanic and spare parts.
- **Vending machine business**: a depot plus machines placed on any pavement in the city; passers-by buy on impulse; cash sits in the machine until a driver's van round (or a paid call-out) restocks and collects.
- **Workshop / factory**: machines with recipes turn ingredients into house brands (including a two-step sauce chain); sell wholesale or ship to your own shops by courier or your own driver.
- **Fun park**: ticket gate with a fair price that rises with your attractions, rides with capacity and fun ratings, arcade machines, snack stall, picnic tables, and guest happiness driving reputation.
- Road traffic: cars drive the street grid, keeping to their lane.
- Cooks and mechanics now have jobs; mechanics repair breakdowns for free and make them rarer. Managers reorder ingredients and fuel as well as shelf stock.
- Stock and price tabs adapt to each business; the overview lists what each one is missing.

## 0.6.0 - Milestone 6: finances, save/load, menus, audio

- Finances window: cash, net worth breakdown, progress to the net-worth goal, a 28-day income vs expenses chart with hover values, and ledgers for today, yesterday and the last 7 days.
- Businesses window listing every shop with reputation, today's revenue, customers served, yesterday's profit and staffing; click a row to jump there.
- Staff window listing everyone on the payroll and what they are doing.
- Save/load: five manual slots plus an autosave (06:00 daily), stored as JSON in `%APPDATA%/BusinessSim/saves`. Quick save with F5. Older saves are migrated on load.
- Main menu with Continue, New Game, Load Game, Settings and Quit; pause menu (Esc) with save, load, settings and quit.
- Settings: master, effects and music volume, fullscreen, window resolution, autosave, and rebindable keys.
- Synthesised sound effects (cash register, door chime, building, selling, alerts) that fade with zoom and are silent off-screen, and a generative background music hook.
- Per-shop cost tracking for profit figures.

## 0.5.0 - Milestone 5: employees, wages and shifts

- Daily candidate pool with names, three skills (speed, friendliness, reliability), traits and asking wages (`src/data/employees.json`).
- Eight roles defined; cashier, stocker, cleaner and manager are active in the convenience store. Security, cook, mechanic and driver come into play with later milestones.
- Staff walk in at the start of their shift, work their station, and leave at the end. Click one to see what they are doing.
- Per-employee shifts with overtime pay, checkout assignment, raises, bonuses and firing.
- Energy drains on shift and recovers off it; morale follows pay fairness, hours, cleanliness and whether a manager is present. Both change work speed. Unhappy staff call in sick or quit.
- Cashiers set checkout speed and colour customer mood; stockers refill shelves; cleaners remove dirt; managers reorder stock automatically.
- Shop cleanliness, bins, and a paid deep clean.
- Daily utilities bill and an end-of-day summary.

## 0.4.0 - Milestone 4: AI customers

- Pedestrians spawn from buildings, the map edge, parks and the beach, following an hourly activity curve (`src/data/population.json`), with more of them in high-traffic neighbourhoods.
- A* pathfinding on the tile grid (8-way, no corner cutting, allocation-free scratch buffers).
- Shoppers have a shopping list, budget, price tolerance, patience and mood. They notice shops as they pass (more often with better reputation), or head straight for a shop they have heard of.
- In the shop they walk to the right shelf, judge the price against the market, take items, queue at a staffed checkout and pay; or leave unhappy if items are missing, sold out, overpriced, or the line is too slow.
- Thought bubbles ("Too expensive!", "Great service!") and floating sale amounts.
- Click any person to see their mood, money, shopping list, basket and recent thoughts.
- Each visit moves the shop's reputation up or down.

## 0.3.0 - Milestone 3: build mode and the convenience store

- Open a business on any lot you hold; the setup fee covers the licence, floor, outer walls and a door.
- Build mode: place furniture on the grid with a ghost preview, rotate (R), move, and sell back; drag to paint floors, walls and doors.
- Furniture, products and shop types are defined in `src/data/furniture.json`, `products.json` and `shops.json`.
- Wholesale ordering with case sizes, bulk discounts, standard and express delivery, and limited back-room storage.
- Shelves, fridges and freezers hold specific product classes; assign a product per section and fill from storage.
- Food expiry: perishable batches are tracked by date and discarded when they spoil.
- Per-product pricing against a market price that drifts daily.
- Checkout that the owner can staff personally (one in the whole city).
- Lots are larger (6x8 tiles and up) so interiors have room for walls.

## 0.2.0 - Milestone 2: city, camera, time, renting

- Generated city: street grid with sidewalks and crosswalks, 30 blocks, two parks, a beach, and about 150 lots of varied sizes.
- Five neighbourhoods (Downtown, Old Town, Suburbs, Industrial Park, Beachfront) with their own foot traffic, customer wealth and rent, defined in `src/data/neighborhoods.json`.
- Camera: drag or WASD/arrows to pan, mouse wheel to zoom toward the cursor, +/- keys.
- Game clock with day/week calendar, pause/1x/2x/4x (Space, 1, 2, 3), and a day/night tint.
- Lots can be rented (deposit plus daily rent at midnight), bought outright, released or sold.
- New Game screen with company name and three difficulties (`src/data/difficulty.json`).
- HTML HUD: top bar, lot panel, toasts and a tooltip system.
- Daily finance ledger groundwork.

## 0.1.0 - Milestone 1: project setup and packaging

- TypeScript + Phaser 3 + Vite project with strict type-checking.
- Electron shell: 1280x720 resizable window, F11 fullscreen, single-instance lock, sandboxed renderer with a minimal preload API.
- Save backend: JSON files in `%APPDATA%/BusinessSim/saves` on desktop (atomic writes), `localStorage` in the browser.
- Main menu placeholder with a storage round-trip check.
- electron-builder config producing a Windows installer and a portable `.exe` in `release/`.
- GitHub Actions workflow that builds both executables on a Windows runner.
