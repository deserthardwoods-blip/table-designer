#!/usr/bin/env python3
"""Make background-free cutouts of every in-stock designer piece.

Reads the same collections as rtd.js (its COLLECTIONS list), applies the same
"single piece with a size in the title" rules, downloads each piece's first
photo, removes the background with rembg (isnet-general-use), keeps only the
largest object (drops rulers, labels, leaves), crops to it, turns the long side
horizontal, and writes:

  cutouts/<variant id>.webp   transparent cutout
  cutouts/index.json          {variant id: {f, src, hull, w, h}}

Pieces that already have a cutout for the same photo are skipped; pieces that
sold (no longer listed) are removed. Run from the repo root:

  python3 tools/make_cutouts.py [--store https://deserthardwoods.com] [--limit N] [--only ID,ID]
"""
import argparse, io, json, os, re, sys, time, urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import ConvexHull

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'cutouts')
INDEX = os.path.join(OUT, 'index.json')
MAX_SIDE = 900          # longest side of saved cutout, px
COLOR_VERSION = 2       # bump to re-colour every cutout on the next run
# Target average colour for the wood, in CIE Lab: a warm, sunlit olive tan.
TARGET_L, TARGET_A, TARGET_B = 60.0, 13.0, 30.0
COLOR_STRENGTH = 0.85   # 1 = match target exactly, 0 = leave photo colours alone
SRC_WIDTH = 1080        # photo width requested from Shopify's CDN

# ---- same rules as rtd.js -------------------------------------------------
NUM = r'(\d+(?:\.\d+)?(?:\s+\d+/\d+)?)'
RE3 = re.compile(NUM + r'\s*["”]\s*x\s*' + NUM + r'\s*["”]\s*x\s*' + NUM + r'\s*["”]', re.I)
RE2 = re.compile(NUM + r'\s*["”]\s*x\s*' + NUM + r'\s*["”]', re.I)
MULTI = re.compile(r'\b(set|sets|pair|kit|kits|pieces|box|mold|offcuts|bundle)\b', re.I)
FOR_TABLE = re.compile(r'\bfor\s+(an?\s+)?(\d+(\.\d+)?\s*["”]?\s*)?(side\s+|round\s+|circular\s+|coffee\s+|dining\s+)?table\b', re.I)


def parse_num(s):
    s = s.strip()
    m = re.match(r'^(\d+)\s+(\d+)/(\d+)$', s)
    if m:
        return int(m[1]) + int(m[2]) / int(m[3])
    return float(s)


def parse_dims(title):
    m = RE3.search(title)
    if m:
        a, b, t = (parse_num(x) for x in m.groups())
        if a and b and t and t < 6:
            return max(a, b), min(a, b), t
    m = RE2.search(title)
    if m:
        d, t = parse_num(m[1]), parse_num(m[2])
        if d >= 6 and 0 < t < 6:
            return d, d, t
    return None


def is_single_piece(title):
    if MULTI.search(title) or FOR_TABLE.search(title):
        return False
    return not re.match(r'^\s*\d+\s+[a-z]', title, re.I)


def collections_from_rtd():
    js = open(os.path.join(ROOT, 'rtd.js'), encoding='utf-8').read()
    block = js[js.index('var COLLECTIONS'):]
    block = block[:block.index('];')]
    return re.findall(r"handle:\s*'([^']+)'", block)


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'desert-hardwoods-cutouts/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def excluded_from_rtd():
    js = open(os.path.join(ROOT, 'rtd.js'), encoding='utf-8').read()
    if 'var EXCLUDE_COLLECTIONS' not in js:
        return []
    block = js[js.index('var EXCLUDE_COLLECTIONS'):]
    block = block[:block.index('];')]
    return re.findall(r"'([^']+)'", block)


def collection_variant_ids(store, handle):
    ids, page = set(), 1
    while page <= 8:
        prods = json.loads(fetch(f'{store}/collections/{handle}/products.json?limit=250&page={page}')).get('products', [])
        for pr in prods:
            ids.update(str(v['id']) for v in pr.get('variants') or [])
        if len(prods) < 250:
            break
        page += 1
    return ids


def pieces(store):
    found = {}
    for handle in collections_from_rtd():
        page = 1
        while page <= 8:
            data = json.loads(fetch(f'{store}/collections/{handle}/products.json?limit=250&page={page}'))
            prods = data.get('products', [])
            for pr in prods:
                vs = pr.get('variants') or []
                if len(vs) != 1 or not vs[0].get('available'):
                    continue
                if not is_single_piece(pr['title']) or not parse_dims(pr['title']):
                    continue
                imgs = pr.get('images') or []
                if not imgs:
                    continue
                cut = next((im['src'] for im in imgs if 'cutout' in im['src'].lower()), None)
                found[str(vs[0]['id'])] = {'title': pr['title'], 'sku': vs[0].get('sku') or '',
                                           'src': cut or imgs[0]['src'], 'prepared': bool(cut)}
            if len(prods) < 250:
                break
            page += 1
    for handle in excluded_from_rtd():          # sets / kits are never offered
        for vid in collection_variant_ids(store, handle):
            found.pop(vid, None)
    return found


# ---- cutout ---------------------------------------------------------------
_session = None


def session():
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session('isnet-general-use')
    return _session


def to_srgb(im):
    """Apply the photo's embedded colour profile (browsers do; Pillow doesn't)."""
    icc = im.info.get('icc_profile')
    if not icc:
        return im
    try:
        from PIL import ImageCms
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        dst = ImageCms.createProfile('sRGB')
        mode = 'RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB'
        return ImageCms.profileToProfile(im.convert(mode), src, dst, outputMode=mode)
    except Exception:  # noqa - unreadable profile: use pixels as-is
        return im


# ---- colour: even out lighting differences between photos --------------
def _srgb_to_lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def _lab_to_srgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx, fz = fy + lab[..., 1] / 500, fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * np.array([0.95047, 1.0, 1.08883])
    M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    c = xyz @ M.T
    c = np.where(c > 0.0031308, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055, 12.92 * c)
    return np.clip(c * 255, 0, 255)


def even_out_color(rgba):
    """Shift the piece's average warmth/brightness toward TARGET, keeping all
    light/dark and grain variation (an additive shift in Lab, not RGB gains,
    so dark bark stays brown instead of turning purple)."""
    a = np.array(rgba).astype(float)
    m = a[..., 3] > 200
    if m.sum() < 100:
        return rgba
    lab = _srgb_to_lab(a[..., :3])
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    mid = m & (L > 25) & (L < 90)                 # judge colour on mid-tones only
    if mid.sum() < 100:
        mid = m
    k = COLOR_STRENGTH
    dA = (TARGET_A - np.median(A[mid])) * k
    dB = (TARGET_B - np.median(B[mid])) * k
    # Pieces already warmer/golder than the target only get toned down a
    # little; pulling yellow out of them turns their dark bark purple.
    if dA < 0: dA *= 0.35
    if dB < 0: dB *= 0.35
    w = np.clip((L - 8) / 30, 0.35, 1.0)        # gentler shift in the darkest bark
    lab[..., 1] = A + dA * w
    lab[..., 2] = B + dB * w
    Lm = np.median(L[mid])                        # brightness: half-way to target
    lab[..., 0] = np.clip(L + (TARGET_L - Lm) * 0.5 * k, 0, 100)
    a[..., :3] = _lab_to_srgb(lab)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def cutout(img_bytes, prepared=False):
    im = to_srgb(Image.open(io.BytesIO(img_bytes))).convert('RGBA')
    if prepared and im.getchannel('A').getextrema()[0] < 250:
        rgba = im                      # already transparent
    else:
        from rembg import remove
        rgb = im.convert('RGB')
        rgb.thumbnail((1024, 1024))
        rgba = remove(rgb, session=session(), post_process_mask=True)
    a = np.array(rgba.getchannel('A'))
    px = np.array(rgba.convert('RGB')).astype(int)
    R, G, B = px[..., 0], px[..., 1], px[..., 2]
    # Olive wood is never distinctly greener or bluer than it is red. Grass,
    # blue rulers/tape, sky and cool shadows are, so they can't hold a piece
    # together with things lying next to it.
    notwood = (B > R + 50) | ((G > R + 25) & (G >= B - 10))   # vivid blue (rulers) or clearly green (grass)
    solid = (a > 128) & ~notwood
    # Break thin bridges (a ruler or label touching the wood) before picking
    # the biggest object, then grow back to the true outline.
    r = max(3, int(max(a.shape) / 110))
    st = ndimage.generate_binary_structure(2, 1)
    opened = ndimage.binary_opening(solid, structure=st, iterations=r)
    lab, n = ndimage.label(opened if opened.any() else solid)
    if n == 0:
        return None, 'nothing found'
    sizes = ndimage.sum(np.ones_like(a), lab, range(1, n + 1))
    keep = int(np.argmax(sizes)) + 1
    mask = solid & ndimage.binary_dilation(lab == keep, structure=st, iterations=r + 2)
    lab2, n2 = ndimage.label(mask)          # drop crumbs the regrow picked up
    if n2 > 1:
        s2 = ndimage.sum(np.ones_like(a), lab2, range(1, n2 + 1))
        mask = lab2 == (int(np.argmax(s2)) + 1)
    # put back cool-coloured spots that sit inside the wood (shadowed bark, moss)
    mask |= notwood & (a > 128) & ndimage.binary_fill_holes(mask)
    frac = mask.sum() / a.size
    if frac < 0.04:
        return None, f'object too small ({frac:.0%})'
    # Solid inside (so resin colour never shows through the wood), soft 1-2px edge.
    # Real voids in the wood stay transparent so resin shows through them.
    inner = ndimage.binary_erosion(mask, iterations=2)
    edge = ndimage.binary_dilation(mask, iterations=1) & ~inner
    alpha = np.zeros_like(a)
    alpha[inner] = 255
    alpha[edge] = np.maximum(a[edge], np.where(mask[edge], 200, 0))
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    arr = np.array(rgba)
    arr[..., 3] = alpha
    crop = arr[y0:y1, x0:x1]
    m = mask[y0:y1, x0:x1]
    if crop.shape[0] > crop.shape[1] * 1.05:   # long side horizontal
        crop = np.rot90(crop, 1)
        m = np.rot90(m, 1)
    out = even_out_color(Image.fromarray(crop, 'RGBA'))
    if max(out.size) > MAX_SIDE:
        out.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    # outline for overlap checks, normalised to -0.5..0.5
    pts = np.argwhere(m)[:, ::-1].astype(float)        # x, y
    hull = pts[ConvexHull(pts).vertices]
    if len(hull) > 32:
        hull = hull[np.linspace(0, len(hull) - 1, 32).astype(int)]
    h, w = m.shape
    hull = [[round(x / w - 0.5, 3), round(y / h - 0.5, 3)] for x, y in hull]
    touches = x0 <= 1 or y0 <= 1 or x1 >= a.shape[1] - 1 or y1 >= a.shape[0] - 1
    return (out, hull, {'frac': round(float(frac), 3), 'edge': bool(touches)}), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--store', default='https://deserthardwoods.com')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', default='')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    index = json.load(open(INDEX)) if os.path.exists(INDEX) else {}
    live = pieces(args.store)
    only = set(filter(None, args.only.split(',')))
    print(f'{len(live)} pieces in stock; {len(index)} cutouts on file', flush=True)

    removed = [k for k in index if k not in live]
    for k in removed:
        f = os.path.join(OUT, index[k]['f'])
        if os.path.exists(f):
            os.remove(f)
        del index[k]

    todo = [k for k, p in live.items()
            if (not only or k in only) and (k not in index or index[k].get('src') != p['src']
                                            or index[k].get('cv') != COLOR_VERSION)]
    if args.limit:
        todo = todo[:args.limit]
    made, failed = [], []
    for i, k in enumerate(todo, 1):
        p = live[k]
        try:
            res, err = cutout(fetch(p['src'] + ('&' if '?' in p['src'] else '?') + f'width={SRC_WIDTH}'), p['prepared'])
        except Exception as e:  # noqa
            res, err = None, str(e)[:120]
        if not res:
            failed.append((k, p['sku'], err))
            print(f'[{i}/{len(todo)}] {p["sku"] or k}: FAILED {err}', flush=True)
            continue
        img, hull, q = res
        fname = f'{k}.webp'
        img.save(os.path.join(OUT, fname), 'WEBP', quality=82, method=6)
        index[k] = {'cv': COLOR_VERSION, 'f': fname, 'src': p['src'], 'sku': p['sku'], 'w': img.size[0], 'h': img.size[1], 'hull': hull, 'q': q}
        made.append(k)
        print(f'[{i}/{len(todo)}] {p["sku"] or k}: ok {img.size} cover={q["frac"]:.0%}{" EDGE" if q["edge"] else ""}', flush=True)

    with open(INDEX, 'w') as fh:
        json.dump(index, fh, separators=(',', ':'), sort_keys=True)
    print(json.dumps({'made': len(made), 'removed': len(removed), 'failed': failed, 'total': len(index)}))


if __name__ == '__main__':
    main()
