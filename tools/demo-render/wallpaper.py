"""Generate a random modern-desktop-style wallpaper (gradient + soft blobs)."""
import colorsys, math, random, sys
from PIL import Image, ImageDraw, ImageFilter

W, H = 1280, 720
OUT = sys.argv[1] if len(sys.argv) > 1 else "wallpaper.png"

random.seed()
base_h = random.random()

def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h % 1.0, l, s)
    return (int(r * 255), int(g * 255), int(b * 255))

# Diagonal base gradient between two analogous hues.
top = hsl(base_h, 0.55, 0.42)
bot = hsl(base_h + 0.08, 0.60, 0.20)
img = Image.new("RGB", (W, H))
px = img.load()
for y in range(H):
    t = y / (H - 1)
    r = int(top[0] * (1 - t) + bot[0] * t)
    g = int(top[1] * (1 - t) + bot[1] * t)
    b = int(top[2] * (1 - t) + bot[2] * t)
    for x in range(W):
        px[x, y] = (r, g, b)

# Soft glowing blobs on an overlay, blurred for a dreamy bokeh look.
blob = Image.new("RGB", (W, H), (0, 0, 0))
bd = ImageDraw.Draw(blob)
for _ in range(6):
    cx, cy = random.randint(0, W), random.randint(0, int(H * 0.7))
    rad = random.randint(120, 340)
    col = hsl(base_h + random.uniform(-0.15, 0.25), 0.7, 0.55)
    bd.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=col)
blob = blob.filter(ImageFilter.GaussianBlur(110))
img = Image.blend(img, Image.eval(blob, lambda v: v), 0.0)  # noop keep types
img = Image.blend(img, blob, 0.45)

# Gentle vignette toward the bottom so pets read against the floor.
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
for y in range(H):
    a = int(90 * (y / (H - 1)) ** 2)
    vd.line([(0, y), (W, y)], fill=a)
img = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), img, vig)

img.save(OUT)
print("wrote", OUT, img.size)
