# Changelog

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
