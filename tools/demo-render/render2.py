"""Render the mock-Windows-desktop demo (taskbar, app windows, climbing)."""
import base64, json, os, time, urllib.request
from websocket import create_connection

PORT = 9222
HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")
WALL = os.path.join(HERE, "wallpaper.png")
CAST = ["klee", "venti", "ayaka", "albedo"]
BANNED = ["spongebob", "deadpool", "cartman"]
CLIPW, CLIPH, PET_SIZE = 1280, 640, 108
FPS, DURATION = 15, 19


def http_json():
    for p in ("/json", "/json/list"):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{p}", timeout=5) as r:
                return json.load(r)
        except Exception:
            continue
    raise RuntimeError("cannot reach CDP")


class CDP:
    def __init__(self, ws_url):
        self.ws = create_connection(ws_url, enable_multithread=True)
        self.ws.settimeout(30)
        self.id = 0

    def send(self, method, **params):
        self.id += 1
        mid = self.id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def eval(self, expr, awaitp=False):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=awaitp, userGesture=True)
        if "exceptionDetails" in r:
            raise RuntimeError("JS: " + json.dumps(r["exceptionDetails"])[:500])
        return r.get("result", {}).get("value")


def find_overlay():
    for _ in range(60):
        for t in http_json():
            if t.get("webSocketDebuggerUrl") and "overlay" in t.get("url", ""):
                return t["webSocketDebuggerUrl"]
        time.sleep(0.5)
    raise RuntimeError("overlay target not found")


def main():
    os.makedirs(FRAMES, exist_ok=True)
    for f in os.listdir(FRAMES):
        os.remove(os.path.join(FRAMES, f))

    wall_uri = "data:image/png;base64," + base64.b64encode(open(WALL, "rb").read()).decode()
    scene_js = open(os.path.join(HERE, "scene_setup.js"), encoding="utf-8").read()
    scene_js = (scene_js
                .replace("__WALL__", wall_uri)
                .replace("__CLIPW__", str(CLIPW))
                .replace("__CLIPH__", str(CLIPH))
                .replace("__PETSIZE__", str(PET_SIZE))
                .replace("__CAST__", json.dumps(CAST))
                .replace("__BANNED__", json.dumps(BANNED)))

    c = CDP(find_overlay())
    c.send("Page.enable")
    c.send("Runtime.enable")

    # Ensure the debug bridge is live (localStorage persists across restarts).
    if not c.eval("!!(window.__pet && window.__pet.runtime && window.__pet.runtime.director)"):
        c.eval("localStorage.setItem('petdebug','1')")
        c.send("Page.reload")
        for _ in range(60):
            time.sleep(0.5)
            try:
                if c.eval("!!(window.__pet && window.__pet.runtime && window.__pet.runtime.director)"):
                    break
            except Exception:
                pass
    print("bridge ready")

    clip = c.eval(scene_js)
    print("scene:", clip)
    time.sleep(1.0)  # window poller clears; pets settle on the floor
    c.eval("window.__demo.start()")  # fire-and-forget async choreography

    total = FPS * DURATION
    interval = 1.0 / FPS
    print(f"capturing {total} frames @ {FPS}fps")
    start = time.time()
    for i in range(total):
        t0 = time.time()
        shot = c.send("Page.captureScreenshot", format="png",
                      clip={"x": clip["clipX"], "y": clip["clipY"],
                            "width": clip["clipW"], "height": clip["clipH"], "scale": 1},
                      captureBeyondViewport=False)
        with open(os.path.join(FRAMES, f"frame_{i:03d}.png"), "wb") as fh:
            fh.write(base64.b64decode(shot["data"]))
        dt = time.time() - t0
        if dt < interval:
            time.sleep(interval - dt)
        if i % 24 == 0:
            print(f"  frame {i}/{total}")
    print("done ->", FRAMES)


if __name__ == "__main__":
    main()
