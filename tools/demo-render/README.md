# Demo render tooling

Scripts that render the looping showcase GIF (mock Windows desktop + pets
walking, doing actions, and climbing windows/screen edges) by driving the real
app headlessly over the Chrome DevTools Protocol. Nothing here ships in the
app; it only reads/animates a running instance.

## How it works

The overlay exposes a **dormant debug bridge** (`window.__pet`) that only
attaches when `localStorage.petdebug === '1'` (see `src/overlay/main.tsx`). The
scripts flip that flag, then spawn a cast and choreograph behaviors through the
engine's own imperatives (`walkTo`, `climbToPlatform`, `climbEdge`,
`playSpecial`). Pets are spawned **ephemerally** — nothing is persisted, so a
render never touches your saved characters or settings. A mock desktop
(wallpaper, browser + VS Code windows, taskbar) is injected as a background
layer, and the code-editor window is registered as a real climbable platform.

## Requirements

- A release build of the app (`npm run tauri build`) — the debug bridge must be
  present in the build you launch.
- Python with `pillow` and `websocket-client`.
- `ffmpeg` on PATH.

## Run

1. Launch the built app in sandbox mode with a remote-debugging port (the
   overlay parks off-screen, the dashboard is hidden, audio is muted):

   ```powershell
   $env:DESKTOP_PET_SANDBOX = "1"
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222 --remote-allow-origins=*"
   Start-Process .\src-tauri\target\release\convai-desktop-pet.exe
   ```

2. Generate a wallpaper, capture frames, and encode the loop:

   ```bash
   python wallpaper.py wallpaper.png   # random gradient desktop background
   python render2.py                   # drives CDP, writes frames/
   python make_gif.py                  # auto-detects the loop point -> demo.gif
   ```

`render2.py` is the driver: tweak `CAST`, `CLIPW/CLIPH`, `PET_SIZE`,
`FPS/DURATION` at the top. `scene_setup.js` is the injected mock desktop +
choreography. `make_gif.py` finds the seamless loop point by frame similarity
and encodes with an ffmpeg palette.
