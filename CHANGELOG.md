# Changelog

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
