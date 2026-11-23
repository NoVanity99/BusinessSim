# Changelog

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
