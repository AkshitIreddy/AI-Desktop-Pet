# Building Convai Desktop Pets

Developer setup for the Tauri v2 rewrite. For a tour of how the app is put
together, read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) first — it is the
design bible for this codebase.

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 20+** | with npm (a `package-lock.json` is committed — use `npm ci` for clean installs) |
| **Rust 1.88+** | install via [rustup](https://rustup.rs); the stable toolchain is all you need |
| **Windows** | WebView2 runtime — ships with Windows 11 (and most updated Windows 10 installs), nothing to do. You'll also want the *Desktop development with C++* workload from Visual Studio Build Tools for the MSVC linker. |
| **Linux** | `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libasound2-dev build-essential` (Debian/Ubuntu names; see the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for other distros) |
| **macOS** | Xcode Command Line Tools: `xcode-select --install` |

## Develop

```bash
git clone https://github.com/AkshitIreddy/convai-desktop-pet.git
cd convai-desktop-pet
npm install
npm run tauri dev
```

`tauri dev` starts the Vite dev server (port 1420), compiles the Rust shell,
and opens both windows — the dashboard and the transparent pet overlay —
with hot reload for the frontend. First Rust compile takes a few minutes;
subsequent runs are incremental.

To iterate on the frontend alone (no windows, no Rust): `npm run dev` serves
the pages in a browser, but anything touching Tauri IPC (spawning pets, screen
capture, tray) only works inside `tauri dev`.

## Build installers

```bash
npm run tauri build
```

Type-checks (`tsc --noEmit`), builds the frontend, compiles Rust in release
mode, and produces platform installers under
`src-tauri/target/release/bundle/`:

- Windows → `nsis/*-setup.exe`
- macOS → `dmg/*.dmg`
- Linux → `deb/*.deb` and `appimage/*.AppImage`

## Project map

```
src/shared/        types, constants, persistence, IPC wrappers, theme, sounds
src/skills/        the 22-skill registry
src/overlay/       pet engine, behavior director, Convai layer, overlay UI
src/dashboard/     dashboard window: characters, settings, docs, onboarding
src-tauri/src/     Rust: window setup, tray, cursor poll, hit regions,
                   window enumeration, screen capture, mic permission
public/assets/     shimeji sprite frames, one folder per character
```

Full detail — window model, Rust⇄frontend contract, engine states, behavior
catalog, Convai integration — in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Release process

Releases are fully automated by [.github/workflows/build.yml](./.github/workflows/build.yml)
(tauri-action, three-OS matrix, one combined release).

1. Bump the version in **all three** places (they must match):
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
2. Commit, then tag and push:

   ```bash
   git tag v2.x.x
   git push origin v2.x.x
   ```

3. CI builds Windows (.exe), macOS (.dmg, Apple Silicon + Intel) and Linux
   (.deb + .AppImage) and publishes a single GitHub release named
   `Convai Desktop Pets v2.x.x` with every artifact attached. No repo secrets
   to configure — the workflow uses the automatic `GITHUB_TOKEN`.
