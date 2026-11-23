# Credits

## Art

The game's pixel art builds on two asset packs by **Kenney** (https://kenney.nl), both released under
[Creative Commons Zero (CC0 1.0)](https://creativecommons.org/publicdomain/zero/1.0/). CC0 needs no
attribution; it is given here with thanks.

| Pack | Version | Used for | Source files |
| --- | --- | --- | --- |
| [RPG Urban Pack](https://kenney.nl/assets/rpg-urban-pack) | 1.0 (2019) | Streets, pavements, roofs, street furniture, trees, vehicles, characters | `art-src/kenney/rpg-urban-pack/` |
| [Roguelike Indoors](https://kenney.nl/assets/roguelike-indoors) | 1.0 | Shop furniture and interiors | `art-src/kenney/roguelike-indoors/` |

The original sheets and their licence files are kept unmodified in `art-src/kenney/`. Tiles are 16×16 px
and are drawn at 2× in the game.

Anything not covered by those packs is drawn in code to match (see `src/art/`), and is part of this
project.

## Sound and music

All sound effects and music are synthesised at runtime by the game's own code (`src/systems/audio/`).
No recordings are used.

## Software

Built with [Phaser 3](https://phaser.io) (MIT), [Electron](https://www.electronjs.org) (MIT),
[electron-builder and electron-updater](https://www.electron.build) (MIT), [Vite](https://vite.dev) (MIT),
[Vitest](https://vitest.dev) (MIT) and [TypeScript](https://www.typescriptlang.org) (Apache-2.0).
