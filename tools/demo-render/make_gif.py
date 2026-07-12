"""Pick the best seamless loop range from captured frames and encode a GIF."""
import os, shutil, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")
SRC = os.path.join(HERE, "gif_src")
OUT = os.path.join(HERE, "demo.gif")
FPS = 12
ANCHOR = 5            # frame index used as the loop's first frame (near a spread hold)
MIN_CYCLE = FPS * 8   # a full choreography cycle is ~10-12s; ignore shorter matches
WIDTH = 1120


def thumbs():
    files = sorted(os.listdir(FRAMES))
    ts = []
    for f in files:
        im = Image.open(os.path.join(FRAMES, f)).convert("L").resize((160, 80))
        ts.append((f, list(im.getdata())))
    return files, ts


def mse(a, b):
    return sum((x - y) * (x - y) for x, y in zip(a, b)) / len(a)


def main():
    files, ts = thumbs()
    n = len(files)
    a = ts[ANCHOR][1]
    best, best_e = 1e18, n - 1
    for e in range(ANCHOR + MIN_CYCLE, n):
        d = mse(ts[e][1], a)
        if d < best:
            best, best_e = d, e
    print(f"frames={n} anchor={ANCHOR} loop_end={best_e} span={best_e-ANCHOR} mse={best:.1f}")

    if os.path.isdir(SRC):
        shutil.rmtree(SRC)
    os.makedirs(SRC)
    for j, i in enumerate(range(ANCHOR, best_e)):
        shutil.copy(os.path.join(FRAMES, files[i]), os.path.join(SRC, f"f_{j:04d}.png"))

    vf = (f"fps={FPS},scale={WIDTH}:-1:flags=lanczos,"
          "split[s0][s1];[s0]palettegen=max_colors=200[p];[s1][p]paletteuse=dither=sierra2_4a")
    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(SRC, "f_%04d.png"),
        "-vf", vf, "-loop", "0", OUT,
    ], check=True)
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
