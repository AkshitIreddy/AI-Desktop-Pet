"""Pick the best seamless loop range from captured frames and encode a GIF."""
import os, shutil, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")
SRC = os.path.join(HERE, "gif_src")
OUT = os.path.join(HERE, "demo.gif")
FPS = 15
MIN_CYCLE = FPS * 7   # ignore matches shorter than a full choreography cycle
WIDTH = 960
COLORS = 128


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
    # Search a small range of start frames (all inside the first spread hold)
    # against every candidate end, and take the pair with the closest match —
    # a hold-to-hold loop point, robust to which exact frame the hold lands on.
    best, best_a, best_e = 1e18, 4, n - 1
    for a in range(3, 16):
        av = ts[a][1]
        for e in range(a + MIN_CYCLE, n):
            d = mse(ts[e][1], av)
            if d < best:
                best, best_a, best_e = d, a, e
    print(f"frames={n} anchor={best_a} loop_end={best_e} span={best_e-best_a} mse={best:.1f}")

    if os.path.isdir(SRC):
        shutil.rmtree(SRC)
    os.makedirs(SRC)
    for j, i in enumerate(range(best_a, best_e)):
        shutil.copy(os.path.join(FRAMES, files[i]), os.path.join(SRC, f"f_{j:04d}.png"))

    # bayer (ordered) dither keeps a static pattern frame-to-frame, so the GIF
    # compresses far better than error-diffusion (sierra) on the white page.
    vf = (f"fps={FPS},scale={WIDTH}:-1:flags=lanczos,"
          f"split[s0][s1];[s0]palettegen=max_colors={COLORS}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=2")
    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(SRC, "f_%04d.png"),
        "-vf", vf, "-loop", "0", OUT,
    ], check=True)
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
