"""Generates the game's tileable textures into ../textures.

Everything is procedural (spectral noise, cellular noise and painted strokes), so the
game ships no third-party assets. Run:  python3 tools/gen_textures.py
"""
import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'textures')
os.makedirs(OUT, exist_ok=True)
R = np.random.default_rng(7)


def norm01(a):
    a = a - a.min()
    return a / (a.max() + 1e-9)


def spectral(n, beta=2.0, ax=1.0, ay=1.0, seed=None):
    """Tileable fractal noise: white noise shaped by a 1/f^beta spectrum."""
    rng = np.random.default_rng(seed) if seed is not None else R
    f = np.fft.fft2(rng.standard_normal((n, n)))
    ky = np.fft.fftfreq(n)[:, None] * ay
    kx = np.fft.fftfreq(n)[None, :] * ax
    k = np.sqrt(kx ** 2 + ky ** 2)
    k[0, 0] = 1
    f *= k ** (-beta / 2)
    f[0, 0] = 0
    return norm01(np.real(np.fft.ifft2(f)))


def band(n, lo, hi, seed=None, ax=1.0, ay=1.0):
    """Tileable noise containing only frequencies between lo and hi cycles per tile."""
    rng = np.random.default_rng(seed) if seed is not None else R
    f = np.fft.fft2(rng.standard_normal((n, n)))
    ky = np.fft.fftfreq(n, 1 / n)[:, None] * ay
    kx = np.fft.fftfreq(n, 1 / n)[None, :] * ax
    k = np.sqrt(kx ** 2 + ky ** 2)
    f *= (k >= lo) & (k <= hi)
    return norm01(np.real(np.fft.ifft2(f)))


def worley(n, cells, seed=None, sx=1.0, sy=1.0):
    """Tileable cellular noise; returns (F1, F2) distances in pixels."""
    rng = np.random.default_rng(seed) if seed is not None else R
    pts = rng.random((cells, 2)) * n
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    f1 = np.full((n, n), 1e9, np.float32)
    f2 = np.full((n, n), 1e9, np.float32)
    for px, py in pts:
        dx = np.abs(xx - px)
        dx = np.minimum(dx, n - dx) * sx
        dy = np.abs(yy - py)
        dy = np.minimum(dy, n - dy) * sy
        d = np.sqrt(dx * dx + dy * dy)
        m = d < f1
        f2 = np.where(m, f1, np.minimum(f2, d))
        f1 = np.where(m, d, f1)
    return f1, f2


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nx, ny, nz = -dx, dy, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5
    return Image.fromarray((rgb * 255).astype(np.uint8))


def ramp(t, stops):
    """Map t in [0,1] through colour stops [(pos, (r,g,b)), ...]."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(t, [s[0] for s in stops], [s[1][c] for s in stops])
    return out


def save(img, name, q=88):
    path = os.path.join(OUT, name)
    if name.endswith('.png'):
        img.save(path, optimize=True)
    else:
        img.convert('RGB').save(path, quality=q, optimize=True)
    print('wrote', name, os.path.getsize(path) // 1024, 'KB')


def to_img(rgb):
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def draw_wrapped(draw, n, fn):
    for ox in (-n, 0, n):
        for oy in (-n, 0, n):
            fn(ox, oy)


# ---------------------------------------------------------------- grass
def grass():
    n = 1024
    patches = spectral(n, 2.6, seed=1)
    mid = spectral(n, 1.6, seed=2)
    base = ramp(patches * 0.7 + mid * 0.3, [
        (0.0, (40, 60, 24)), (0.35, (54, 80, 30)), (0.6, (72, 98, 38)), (0.85, (96, 110, 52)), (1.0, (112, 108, 62))])
    img = to_img(base)
    hmap = Image.new('L', (n, n), 90)
    d, dh = ImageDraw.Draw(img), ImageDraw.Draw(hmap)
    rng = np.random.default_rng(3)
    for _ in range(95000):
        x, y = rng.random() * n, rng.random() * n
        a = rng.random() * math.tau
        L = 5 + rng.random() * 14
        x2, y2 = x + math.cos(a) * L, y + math.sin(a) * L
        p = patches[int(y) % n, int(x) % n]
        tone = rng.random()
        g = 60 + tone * 75 + p * 25
        col = (int(g * (0.42 + rng.random() * 0.2)), int(g), int(g * (0.22 + rng.random() * 0.12)))
        if rng.random() < 0.06:
            col = (int(g * 0.75), int(g * 0.72), int(g * 0.35))  # dry blade
        w = 1 if rng.random() < 0.7 else 2
        hv = int(110 + tone * 145)

        def blade(ox, oy):
            if -20 < x + ox < n + 20 and -20 < y + oy < n + 20:
                d.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=col, width=w)
                dh.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=hv, width=w)
        draw_wrapped(d, n, blade)
    img = img.filter(ImageFilter.UnsharpMask(1.2, 60, 2))
    save(img, 'grass.jpg')
    h = np.asarray(hmap, np.float32) / 255
    save(normal_map(h, 2.2), 'grass_n.jpg')


# ---------------------------------------------------------------- layered cliff rock
def cliff():
    n = 1024
    bands = 9
    warp = spectral(n, 2.4, ax=1.0, ay=0.6, seed=11) - 0.5
    rows = np.mgrid[0:n, 0:n][0].astype(np.float32)
    coord = (rows + warp * 70) / (n / bands)
    layer = np.floor(coord).astype(int) % bands
    frac = coord - np.floor(coord)
    rng = np.random.default_rng(12)
    pal = np.array([(118, 92, 70), (142, 112, 82), (96, 78, 64), (160, 132, 98), (110, 100, 90),
                    (134, 102, 72), (88, 72, 60), (150, 124, 96), (120, 108, 96)], np.float32)
    rng.shuffle(pal)
    col = pal[layer]
    streak = spectral(n, 1.8, ax=0.15, ay=1.0, seed=13)       # fine horizontal streaks
    grain = spectral(n, 1.1, seed=14)
    big = spectral(n, 2.8, seed=15)
    f1, f2 = worley(n, 34, seed=16, sx=1.0, sy=2.2)
    breakup = spectral(n, 2.0, seed=17)
    cracks = np.clip((f2 - f1) / 2.5 + (breakup > 0.45) * 1.0, 0, 1)
    shade = 0.72 + streak[..., None] * 0.28 + (grain[..., None] - 0.5) * 0.25 + (big[..., None] - 0.5) * 0.3
    edge = np.clip(np.minimum(frac, 1 - frac) * 14, 0, 1)        # dark seams between layers
    pits = spectral(n, 0.6, seed=18)
    shade *= (0.6 + 0.4 * edge[..., None]) * (0.7 + 0.3 * cracks[..., None]) * (0.9 + 0.2 * pits[..., None])
    save(to_img(col * shade), 'cliff.jpg')
    lip = np.array([rng.random() for _ in range(bands)])[layer]
    h = lip * 0.6 + frac * 0.25 + streak * 0.3 + grain * 0.25 + big * 0.3 - (1 - cracks) * 0.35 - (1 - edge) * 0.4
    save(normal_map(h, 3.2), 'cliff_n.jpg')


# ---------------------------------------------------------------- generic rock
def rock():
    n = 512
    big = spectral(n, 2.6, seed=21)
    mid = spectral(n, 1.7, seed=22)
    fine = spectral(n, 0.9, seed=23)
    f1, f2 = worley(n, 18, seed=24)
    g1, g2 = worley(n, 70, seed=25)
    warp = spectral(n, 2.0, seed=26)
    cracks = np.clip((f2 - f1) / 9.0 + warp * 0.5, 0, 1) ** 0.6
    small = np.clip((g2 - g1) / 4.0 + mid * 0.6, 0, 1) ** 0.5
    t = big * 0.5 + mid * 0.35 + fine * 0.15
    col = ramp(t, [(0, (64, 60, 56)), (0.35, (98, 92, 84)), (0.65, (128, 120, 108)), (1, (156, 146, 130))])
    lichen = np.clip((spectral(n, 2.4, seed=27) - 0.7) * 3, 0, 1)[..., None] * 0.5
    col = col * (1 - lichen) + np.array([120, 124, 80]) * lichen
    speck = (fine > 0.8)[..., None] * 18 - (fine < 0.15)[..., None] * 14
    col = (col + speck) * (0.7 + 0.3 * cracks[..., None]) * (0.85 + 0.15 * small[..., None])
    save(to_img(col), 'rock.jpg')
    save(normal_map(big * 0.9 + mid * 0.6 + fine * 0.25 - (1 - cracks) * 0.5 - (1 - small) * 0.2, 3.0), 'rock_n.jpg')


# ---------------------------------------------------------------- sand
def sand():
    n = 512
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    warp = spectral(n, 2.5, seed=31)
    ripples = 0.5 + 0.5 * np.sin((yy / n * 22 + warp * 6 + np.sin(xx / n * math.tau * 2) * 0.6) * math.tau)
    grain = spectral(n, 0.4, seed=32)
    patches = spectral(n, 2.8, seed=33)
    t = patches * 0.45 + ripples * 0.25 + grain * 0.3
    col = ramp(t, [(0, (176, 150, 110)), (0.5, (206, 182, 140)), (1, (232, 214, 176))])
    col += ((grain > 0.9)[..., None] * -40) + ((grain < 0.06)[..., None] * 25)
    save(to_img(col), 'sand.jpg')
    save(normal_map(ripples * 0.6 + grain * 0.4, 2.0), 'sand_n.jpg')


# ---------------------------------------------------------------- ice
def ice():
    n = 1024
    depth = spectral(n, 2.7, seed=41)
    cloud = spectral(n, 1.6, seed=42)
    f1, f2 = worley(n, 70, seed=43)
    crack = np.clip(1 - (f2 - f1) / 2.2, 0, 1)
    g1, g2 = worley(n, 260, seed=44)
    fine = np.clip(1 - (g2 - g1) / 1.4, 0, 1) * 0.5
    col = ramp(depth * 0.7 + cloud * 0.3, [(0, (96, 150, 190)), (0.5, (150, 200, 228)), (1, (205, 235, 248))])
    col = col + (crack[..., None] * 90) + (fine[..., None] * 50)
    rng = np.random.default_rng(45)
    img = to_img(col)
    d = ImageDraw.Draw(img)
    for _ in range(900):  # trapped air bubbles
        x, y, r = rng.random() * n, rng.random() * n, 0.6 + rng.random() ** 3 * 4
        d.ellipse([x - r, y - r, x + r, y + r], outline=(235, 248, 255))
    save(img, 'ice.jpg')
    save(normal_map(-crack * 0.7 - fine * 0.4 + cloud * 0.3, 2.5), 'ice_n.jpg')


# ---------------------------------------------------------------- bark
def bark():
    n = 512
    ridges = spectral(n, 2.2, ax=1.0, ay=0.08, seed=51)
    ridges = np.abs(ridges - 0.5) * 2
    f1, f2 = worley(n, 60, seed=52, sx=1.0, sy=0.25)
    plates = np.clip((f2 - f1) / 8, 0, 1)
    fine = spectral(n, 1.0, seed=53)
    moss = spectral(n, 2.8, seed=54)
    h = (1 - ridges) * 0.6 + plates * 0.4 + fine * 0.15
    col = ramp(h, [(0, (28, 20, 14)), (0.45, (66, 50, 36)), (0.8, (104, 86, 66)), (1, (128, 112, 92))])
    m = np.clip((moss - 0.62) * 4, 0, 1)[..., None] * np.clip(h - 0.3, 0, 1)[..., None]
    col = col * (1 - m) + np.array([70, 92, 40]) * m
    save(to_img(col), 'bark.jpg')
    save(normal_map(h, 4.0), 'bark_n.jpg')


# ---------------------------------------------------------------- wood planks (grain along u)
def wood():
    n = 512
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    warp = spectral(n, 2.4, ax=0.15, ay=1.0, seed=61)
    rings = 0.5 + 0.5 * np.sin((yy / n * 10 + warp * 3) * math.tau)
    rings = rings ** 2.2
    fibres = spectral(n, 1.4, ax=0.03, ay=1.0, seed=62)
    t = rings * 0.5 + fibres * 0.5
    col = ramp(t, [(0, (96, 62, 36)), (0.45, (140, 96, 58)), (0.8, (170, 122, 76)), (1, (188, 140, 92))])
    rng = np.random.default_rng(63)
    for _ in range(3):  # knots
        kx, ky = rng.random() * n, rng.random() * n
        dx = np.minimum(np.abs(xx - kx), n - np.abs(xx - kx)) / 3.0
        dy = np.minimum(np.abs(yy - ky), n - np.abs(yy - ky))
        k = np.exp(-(dx * dx + dy * dy) / 120.0)[..., None]
        col = col * (1 - k * 0.6)
    save(to_img(col), 'wood.jpg')
    save(normal_map(rings * 0.4 + fibres * 0.6, 1.8), 'wood_n.jpg')


# ---------------------------------------------------------------- leaf cluster card (RGBA)
def leaves():
    n = 1024
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(71)
    # twigs
    for _ in range(9):
        a = rng.random() * math.tau
        L = n * (0.25 + rng.random() * 0.2)
        d.line([(n / 2, n / 2), (n / 2 + math.cos(a) * L, n / 2 + math.sin(a) * L)], fill=(60, 44, 28, 255), width=5)
    for _ in range(260):
        r = (rng.random() ** 0.6) * n * 0.44
        a = rng.random() * math.tau
        cx, cy = n / 2 + math.cos(a) * r, n / 2 + math.sin(a) * r
        ang = a + (rng.random() - 0.5) * 1.6
        L, W = 52 + rng.random() * 46, 0
        W = L * (0.36 + rng.random() * 0.12)
        g = rng.random()
        base = np.array([40 + g * 50, 80 + g * 70, 20 + g * 30])
        if rng.random() < 0.08:
            base = np.array([120 + g * 40, 130 + g * 30, 40])  # yellowing leaf
        pts = []
        for i in range(17):  # leaf outline
            t = i / 16
            w = math.sin(t * math.pi) ** 0.8 * W / 2
            pts.append((t * L, w))
        pts += [(t, -w) for t, w in reversed(pts[1:-1])]
        ca, sa = math.cos(ang), math.sin(ang)
        poly = [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]
        shade = 0.75 + rng.random() * 0.4
        d.polygon(poly, fill=tuple(int(min(255, c * shade)) for c in base) + (255,))
        d.line([(cx, cy), (cx + L * ca, cy + L * sa)], fill=tuple(int(c * shade * 0.7) for c in base) + (255,), width=2)
    img = img.filter(ImageFilter.SMOOTH)
    save(img, 'leaves.png')


# ---------------------------------------------------------------- grass card (RGBA)
def grass_card():
    w, h = 512, 512
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(81)
    for _ in range(46):
        x0 = 30 + rng.random() * (w - 60)
        hh = h * (0.45 + rng.random() * 0.53)
        bend = (rng.random() - 0.5) * 180
        bw = 2.5 + rng.random() * 3.5
        g = rng.random()
        pts_l, pts_r = [], []
        for i in range(13):
            t = i / 12
            x = x0 + bend * t * t
            y = h - t * hh
            ww = bw * (0.55 + 0.45 * math.sin(min(1, t * 3) * math.pi / 2)) * (1 - t) ** 0.9
            pts_l.append((x - ww, y))
            pts_r.append((x + ww, y))
        dry = rng.random() < 0.1
        top = (140 + g * 50, 150 + g * 40, 60) if dry else (70 + g * 60, 120 + g * 70, 30 + g * 30)
        for i in range(12):  # gradient: dark at the root, light at the tip
            t = i / 12
            c = tuple(int(top[k] * (0.22 + 0.78 * t ** 0.8)) for k in range(3)) + (255,)
            d.polygon([pts_l[i], pts_r[i], pts_r[i + 1], pts_l[i + 1]], fill=c)
    save(img, 'grass_card.png')


# ---------------------------------------------------------------- flowers card (RGBA)
def flowers():
    w, h = 512, 256
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(91)
    kinds = [((245, 245, 240), (230, 190, 40)), ((240, 200, 40), (180, 110, 20)), ((170, 110, 220), (240, 220, 120)), ((240, 120, 150), (250, 220, 120))]
    for i in range(14):
        x = 20 + rng.random() * (w - 40)
        top = 40 + rng.random() * 110
        d.line([(x, h), (x + (rng.random() - 0.5) * 30, top)], fill=(60, 110, 40, 255), width=3)
        pet, cen = kinds[i % len(kinds)]
        cx, cy = x + (rng.random() - 0.5) * 30, top
        r = 10 + rng.random() * 8
        for k in range(8):
            a = k / 8 * math.tau
            px, py = cx + math.cos(a) * r * 0.75, cy + math.sin(a) * r * 0.75
            d.ellipse([px - r * 0.45, py - r * 0.45, px + r * 0.45, py + r * 0.45], fill=pet + (255,))
        d.ellipse([cx - r * 0.35, cy - r * 0.35, cx + r * 0.35, cy + r * 0.35], fill=cen + (255,))
    save(img, 'flowers.png')


# ---------------------------------------------------------------- cloud puff (RGBA)
def cloud():
    n = 256
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    r = np.sqrt((xx - n / 2) ** 2 + (yy - n / 2) ** 2) / (n / 2)
    noise = spectral(n, 2.0, seed=101)
    fine = spectral(n, 1.2, seed=102)
    a = np.clip(1 - r * (1.0 + (noise - 0.5) * 0.9), 0, 1) ** 1.4
    a = np.clip(a * (0.65 + fine * 0.6), 0, 1)
    shade = 200 + 55 * np.clip(1 - (yy / n) * 0.8 + (noise - 0.5) * 0.4, 0, 1)
    rgba = np.stack([shade, shade, shade + 5, a * 255], -1)
    save(Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA'), 'cloud.png')


# ---------------------------------------------------------------- water normals
def water():
    n = 512
    h = band(n, 3, 10, seed=111) * 0.6 + band(n, 10, 30, seed=112) * 0.3 + band(n, 30, 70, seed=113) * 0.1
    save(normal_map(h, 6.0), 'water_n.jpg')


# ---------------------------------------------------------------- moon
def moon():
    n = 256
    base = spectral(n, 2.4, seed=121)
    col = ramp(base, [(0, (150, 150, 150)), (1, (225, 225, 220))])
    img = to_img(col)
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(122)
    for _ in range(40):
        x, y, r = rng.random() * n, rng.random() * n, 3 + rng.random() ** 2 * 18
        d.ellipse([x - r, y - r, x + r, y + r], fill=(168, 168, 165), outline=(212, 212, 206))
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    a = np.asarray(img).astype(np.float32)
    yy, xx = np.mgrid[0:n, 0:n]
    disc = ((xx - n / 2) ** 2 + (yy - n / 2) ** 2) < (n / 2 - 2) ** 2
    rgba = np.dstack([a, disc * 255])
    save(Image.fromarray(rgba.astype(np.uint8), 'RGBA'), 'moon.png')


if __name__ == '__main__':
    import sys
    only = set(sys.argv[1:])
    for fn in (grass, cliff, rock, sand, ice, bark, wood, leaves, grass_card, flowers, cloud, water, moon):
        if not only or fn.__name__ in only:
            fn()
