# BusinessSim

A top-down 2D business tycoon game for Windows. Start broke with one tiny shop and grow into a city-wide empire.

Built with TypeScript, Phaser 3, Vite and Electron.

**Status:** milestone 6 of 9 (finances, save/load, menus, audio). See [CHANGELOG.md](CHANGELOG.md).

## Requirements (for building only)

- Node.js 20 or newer
- The finished `.exe` needs nothing installed on the player's PC.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies (first time only) |
| `npm run dev` | Run in the browser at http://localhost:5173 with hot reload. Saves go to `localStorage`. |
| `npm run dev:electron` | Run inside the Electron window with hot reload |
| `npm run build` | Type-check, then build the game to `dist/` and the Electron shell to `dist-electron/` |
| `npm start` | Build and launch the desktop app locally |
| `npm run dist:win` | Build the Windows installer and portable `.exe` into `release/` |
| `npm run dist:win:portable` | Build only the portable `.exe` (works from Linux/macOS without Wine) |

### Building the .exe

On Windows:

```bash
npm install
```

```bash
npm run dist:win
```

Output in `release/`:

- `BusinessSim-Setup-<version>.exe`: installer (choose install folder, Start menu shortcut, uninstaller)
- `BusinessSim-Portable-<version>.exe`: single file, runs without installing

The executables are unsigned, so Windows SmartScreen shows a warning on first run ("More info" then "Run anyway").

GitHub Actions also builds both files on a Windows runner for every push (`.github/workflows/build-windows.yml`). Download them from the run's **Artifacts** section.

Cross-building from Linux/macOS: the portable target works as is. The installer target needs a working Wine, so use `dist:win:portable` or the GitHub Actions build instead.

To embed a custom icon and version info in the `.exe`, put `icon.ico` (256x256) in `build/`, set `signAndEditExecutable: true` in `electron-builder.yml`, and build on Windows.

## Controls

- Drag with the mouse, or `WASD` / arrow keys: move the camera
- Mouse wheel, `+` / `-`: zoom
- `Space`: pause, `1` / `2` / `3`: speed 1x / 2x / 4x
- Left click: select a person, a lot or a piece of furniture, `Esc`: deselect or put the tool away
- Build mode: left click places, drag paints floors and walls, `R` rotates, right click cancels; pan with the middle or right mouse button
- `B` / `F` / `T`: businesses, finances and staff windows
- `Esc`: back out of the current selection, then open the pause menu
- `F5`: quick save to slot 1
- `F11`: toggle fullscreen

All keys except `F11` can be rebound in Settings.
- `F12`: developer tools (development builds only)

## Save files

- Desktop: `%APPDATA%\BusinessSim\saves\*.json` (five slots, an autosave, and `settings.json`)
- Browser dev mode: `localStorage` keys prefixed `businesssim:`

## Project layout

```
electron/          Electron main process and preload (window, save-file IPC)
src/main.ts        Phaser game config and scene list
src/scenes/        Phaser scenes (boot, menus, city, HUD)
src/systems/       Game logic: time, economy, ai, save, build, staff, events, audio
src/entities/      Customers, employees, shops, lots, furniture
src/data/          JSON definitions (shops, products, furniture, employees, upgrades)
src/ui/            Reusable UI widgets and the shared colour theme
src/art/           Procedural placeholder art, keyed by sprite id
src/core/          Platform bridge, shared state, constants
```

The game is data-driven: shop types, products, furniture and upgrades live in `src/data/*.json`.
