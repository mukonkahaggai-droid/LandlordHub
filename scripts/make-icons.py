"""Makes every app icon from the logo (icons/logo.webp).

    python scripts/make-icons.py

The logo is wider than it is tall, so it is centred on a square of its own red background.
Android and installed web apps cut icons into circles or rounded squares, so those versions
keep the logo inside the "safe zone" in the middle, where nothing is ever cut off.
Run it again whenever the logo changes, then `npm run android:sync`.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..')
logo = Image.open(os.path.join(ROOT, 'icons', 'logo.webp')).convert('RGB')

# The logo's own background colour, taken from its corner, so the square blends in seamlessly.
BG = logo.getpixel((4, 4))


def square(size, logo_width):
    """The logo, `logo_width` of the way across, centred on a `size` square of the logo's red."""
    canvas = Image.new('RGB', (size, size), BG)
    w = round(size * logo_width)
    h = round(w * logo.height / logo.width)
    canvas.paste(logo.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return canvas


def round_mask(img):
    """Circle-shaped copy, for older Android launchers that ask for a round icon."""
    out = img.convert('RGBA')
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
    out.putalpha(mask)
    return out


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    print('wrote', os.path.relpath(path, ROOT))


# ---- Web app (browser tab, home-screen install, iPhone) ----
save(square(192, 0.92), 'icons', 'icon-192.png')
save(square(512, 0.92), 'icons', 'icon-512.png')
save(square(180, 0.92), 'icons', 'apple-touch-icon.png')
# "Maskable": phones may crop to a circle, so the logo stays inside the middle 80%.
save(square(512, 0.74), 'icons', 'icon-maskable-512.png')

# ---- Android app ----
RES = ('android', 'app', 'src', 'main', 'res')
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in DENSITIES.items():
    legacy = square(round(48 * k), 0.82)                 # older phones: the whole square is shown
    save(legacy, *RES, f'mipmap-{name}', 'ic_launcher.png')
    save(round_mask(square(round(48 * k), 0.72)), *RES, f'mipmap-{name}', 'ic_launcher_round.png')
    # Android 8+: 108dp layer, of which only the middle 66dp is sure to show.
    save(square(round(108 * k), 0.58), *RES, f'mipmap-{name}', 'ic_launcher_foreground.png')

# The adaptive icon's background layer uses the same red (res/values/ic_launcher_background.xml).
print('background colour: #%02X%02X%02X' % BG)
