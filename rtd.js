/* Desert Hardwoods — Resin Table Designer
 * Vanilla JS, no dependencies. Reads live products from two collections'
 * products.json, parses L"xW"xT" from titles, and lets shoppers lay real
 * pieces onto a scale sketch of their table.
 */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var IN3_PER_GALLON = 231;

  var RESINS = [
    { id: 'clear', name: 'Clear', fill: '#d9e6ea', edge: '#9fb6bd' },
    { id: 'black', name: 'Black', fill: '#1f2023', edge: '#000000' },
    { id: 'ocean', name: 'Ocean blue', fill: '#1f6f8b', edge: '#14495c' },
    { id: 'white', name: 'White', fill: '#f3f1ec', edge: '#cfcac0' },
    { id: 'green', name: 'Emerald', fill: '#1d6b4f', edge: '#114331' },
    { id: 'smoke', name: 'Smoky gray', fill: '#7d8289', edge: '#565a60' }
  ];

  var PRESETS = {
    rect: [
      { label: 'Coffee table', L: 48, W: 24 },
      { label: 'Desk', L: 60, W: 30 },
      { label: 'Dining (6 seat)', L: 72, W: 36 },
      { label: 'Dining (8 seat)', L: 84, W: 40 },
      { label: 'Dining (10 seat)', L: 96, W: 42 }
    ],
    round: [
      { label: 'Side table', L: 24, W: 24 },
      { label: 'Café table', L: 36, W: 36 },
      { label: 'Round dining', L: 44, W: 44 },
      { label: 'Round dining (6)', L: 54, W: 54 },
      { label: 'Large round', L: 60, W: 60 }
    ]
  };
  var THICKNESSES = [1.25, 1.5, 2.25];

  /* ---------- helpers ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function fmtIn(v) {
    var r = Math.round(v * 100) / 100;
    return (r % 1 === 0 ? r.toFixed(0) : String(r)) + '"';
  }
  function parseNum(s) {
    s = s.trim();
    var m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (m) return +m[1] + (+m[2] / +m[3]);
    m = s.match(/^(\d+)\/(\d+)$/);
    if (m) return +m[1] / +m[2];
    return parseFloat(s);
  }
  // Pulls 25"x16"x2"  /  25"x 16" x 2 1/4"  /  24"x 1 1/2" (round) out of a title.
  var NUM = '(\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?)';
  var RE3 = new RegExp(NUM + '\\s*["”]\\s*x\\s*' + NUM + '\\s*["”]\\s*x\\s*' + NUM + '\\s*["”]', 'i');
  var RE2 = new RegExp(NUM + '\\s*["”]\\s*x\\s*' + NUM + '\\s*["”]', 'i');
  function parseDims(title) {
    var m = title.match(RE3);
    if (m) {
      var a = parseNum(m[1]), b = parseNum(m[2]), t = parseNum(m[3]);
      if (a && b && t && t < 6) return { L: Math.max(a, b), W: Math.min(a, b), T: t };
    }
    m = title.match(RE2);
    if (m) {
      var d = parseNum(m[1]), t2 = parseNum(m[2]);
      if (d >= 6 && t2 > 0 && t2 < 6) return { L: d, W: d, T: t2 };
    }
    return null;
  }
  var MULTI = /\b(set|sets|pair|kit|kits|pieces|box|mold|offcuts|bundle)\b/i;
  var FOR_TABLE = /\bfor\s+(an?\s+)?(\d+(\.\d+)?\s*["”]?\s*)?(side\s+|round\s+|circular\s+|coffee\s+|dining\s+)?table\b/i;
  function isSinglePiece(title) {
    if (MULTI.test(title)) return false;
    if (FOR_TABLE.test(title)) return false; // "Olive Wood for Table 24"…", "…for 36" Table"
    return !/^\s*\d+\s+[a-z]/i.test(title); // "6 Live Edge…", "15 Small…"
  }
  // Shape from the title's name part (before " - "), falling back to the collection.
  function kindOf(title, fallback) {
    var name = title.split(/\s[-–—]\s/)[0];
    if (/\b(cookie|cookies|slice|slices|round)\b/i.test(name)) return 'cookie';
    if (/\b(slab|slabs|board|lumber)\b/i.test(name)) return 'slab';
    return fallback;
  }
  function money(cents, fmt) {
    var amount = (cents / 100).toFixed(2);
    var withCommas = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var noDec = withCommas.replace(/\.00$/, '');
    return (fmt || '${{amount}}')
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/, noDec.split('.')[0])
      .replace(/\{\{\s*amount\s*\}\}/, withCommas)
      .replace(/<[^>]*>/g, '');
  }
  function imgUrl(src, w) {
    if (!src) return '';
    return src + (src.indexOf('?') > -1 ? '&' : '?') + 'width=' + w;
  }
  function b64e(o) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64d(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  }

  /* ---------- geometry ---------- */
  function localPoly(p) {
    var pts = [], i;
    if (p.hull && p.hull.length > 2) return p.hull.map(function (q) { return [q[0] * p.L, q[1] * p.W]; });
    if (p.kind === 'cookie') {
      for (i = 0; i < 28; i++) {
        var a = (i / 28) * Math.PI * 2;
        pts.push([Math.cos(a) * p.L / 2, Math.sin(a) * p.W / 2]);
      }
    } else {
      pts = [[-p.L / 2, -p.W / 2], [p.L / 2, -p.W / 2], [p.L / 2, p.W / 2], [-p.L / 2, p.W / 2]];
    }
    return pts;
  }
  function worldPoly(piece, pl) {
    var r = pl.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return localPoly(piece).map(function (q) { return [pl.x + q[0] * c - q[1] * s, pl.y + q[0] * s + q[1] * c]; });
  }
  function project(poly, ax) {
    var mn = Infinity, mx = -Infinity;
    for (var i = 0; i < poly.length; i++) { var d = poly[i][0] * ax[0] + poly[i][1] * ax[1]; if (d < mn) mn = d; if (d > mx) mx = d; }
    return [mn, mx];
  }
  function overlap(A, B) { // SAT, convex polygons; returns penetration depth (0 = none)
    var minPen = Infinity, polys = [A, B];
    for (var p = 0; p < 2; p++) {
      var P = polys[p];
      for (var i = 0; i < P.length; i++) {
        var a = P[i], b = P[(i + 1) % P.length];
        var ax = [-(b[1] - a[1]), b[0] - a[0]], len = Math.hypot(ax[0], ax[1]);
        if (!len) continue;
        ax = [ax[0] / len, ax[1] / len];
        var pa = project(A, ax), pb = project(B, ax);
        var pen = Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]);
        if (pen <= 0) return 0;
        if (pen < minPen) minPen = pen;
      }
    }
    return minPen;
  }
  function inConvex(poly, x, y) {
    var sign = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (cr !== 0) { var s = cr > 0 ? 1 : -1; if (!sign) sign = s; else if (s !== sign) return false; }
    }
    return true;
  }

  /* ---------- photo cutout: strip background, keep only the wood ---------- */
  // Runs in the shopper's browser. Seeds from the photo's border, flood-fills
  // background-coloured pixels inward, keeps the largest remaining blob (drops
  // SKU text / logos), crops to it and turns the long side horizontal.
  // An image whose file name contains "cutout" (transparent PNG) is preferred.
  var CUT_SIZE = 480;
  function makeCutout(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try { resolve(cutoutFromImage(img)); } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }
  function cutoutFromImage(img) {
    var sc = Math.min(1, CUT_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(8, Math.round(img.naturalWidth * sc)), h = Math.max(8, Math.round(img.naturalHeight * sc));
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0, w, h);
    var data = cx.getImageData(0, 0, w, h); // throws if the CDN blocks CORS -> fallback
    var px = data.data, n = w * h, i, x, y;

    // Background palette from the border (up to 6 colour bins, ignoring rare ones).
    var bins = {}, borderCount = 0;
    function addBorder(idx) {
      var o = idx * 4;
      if (px[o + 3] < 30) return;
      var key = (px[o] >> 4) + ',' + (px[o + 1] >> 4) + ',' + (px[o + 2] >> 4);
      var b = bins[key] || (bins[key] = { r: 0, g: 0, b: 0, c: 0 });
      b.r += px[o]; b.g += px[o + 1]; b.b += px[o + 2]; b.c++; borderCount++;
    }
    for (x = 0; x < w; x++) { addBorder(x); addBorder(x + w); addBorder((h - 1) * w + x); addBorder((h - 2) * w + x); }
    for (y = 0; y < h; y++) { addBorder(y * w); addBorder(y * w + 1); addBorder(y * w + w - 1); addBorder(y * w + w - 2); }
    var pal = Object.keys(bins).map(function (k) { var b = bins[k]; return { r: b.r / b.c, g: b.g / b.c, b: b.b / b.c, c: b.c }; })
      .filter(function (b) { return b.c > borderCount * 0.03; })
      .sort(function (a, b) { return b.c - a.c; }).slice(0, 6);

    var T = 46 * 46, STEP = 22 * 22;
    function nearBg(o) {
      if (px[o + 3] < 30) return true;
      for (var k = 0; k < pal.length; k++) {
        var dr = px[o] - pal[k].r, dg = px[o + 1] - pal[k].g, db = px[o + 2] - pal[k].b;
        if (dr * dr + dg * dg + db * db < T) return true;
      }
      return false;
    }
    function close(a, b) { // neighbouring pixels similar (lets fill follow soft shadows/gradients)
      var dr = px[a] - px[b], dg = px[a + 1] - px[b + 1], db = px[a + 2] - px[b + 2];
      return dr * dr + dg * dg + db * db < STEP;
    }

    // Flood fill background from every border pixel.
    var bg = new Uint8Array(n), stack = [];
    function seed(idx) { if (!bg[idx] && nearBg(idx * 4)) { bg[idx] = 1; stack.push(idx); } }
    for (x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      var c = stack.pop(), cx0 = c % w, co = c * 4;
      var nb = [cx0 > 0 ? c - 1 : -1, cx0 < w - 1 ? c + 1 : -1, c >= w ? c - w : -1, c < n - w ? c + w : -1];
      for (var q = 0; q < 4; q++) {
        var d = nb[q];
        if (d < 0 || bg[d]) continue;
        var dO = d * 4;
        if (nearBg(dO) || (px[dO + 3] < 30) || (close(co, dO) && nearBgLoose(dO))) { bg[d] = 1; stack.push(d); }
      }
    }
    function nearBgLoose(o) {
      for (var k = 0; k < pal.length; k++) {
        var dr = px[o] - pal[k].r, dg = px[o + 1] - pal[k].g, db = px[o + 2] - pal[k].b;
        if (dr * dr + dg * dg + db * db < T * 2.2) return true;
      }
      return false;
    }

    // Largest connected foreground blob.
    var lab = new Int32Array(n), best = 0, bestSize = 0, cur = 0;
    for (i = 0; i < n; i++) {
      if (bg[i] || lab[i]) continue;
      cur++; var size = 0; stack.push(i); lab[i] = cur;
      while (stack.length) {
        var p2 = stack.pop(); size++;
        var px2 = p2 % w;
        var nb2 = [px2 > 0 ? p2 - 1 : -1, px2 < w - 1 ? p2 + 1 : -1, p2 >= w ? p2 - w : -1, p2 < n - w ? p2 + w : -1];
        for (var r = 0; r < 4; r++) { var e = nb2[r]; if (e >= 0 && !bg[e] && !lab[e]) { lab[e] = cur; stack.push(e); } }
      }
      if (size > bestSize) { bestSize = size; best = cur; }
    }
    var frac = bestSize / n;
    if (!best || frac < 0.08 || frac > 0.97) return null; // couldn't separate cleanly

    // Bounding box + alpha mask with a 1px soft edge.
    var x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (i = 0; i < n; i++) if (lab[i] === best) { x = i % w; y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 10 || bh < 10) return null;
    if (bw > w * 0.985 && bh > h * 0.985) return null; // wood touches every edge: no real background found
    for (i = 0; i < n; i++) {
      var inside = lab[i] === best;
      if (!inside) { px[i * 4 + 3] = 0; continue; }
      x = i % w; y = (i / w) | 0;
      var edge = (x > 0 && lab[i - 1] !== best) || (x < w - 1 && lab[i + 1] !== best) || (y > 0 && lab[i - w] !== best) || (y < h - 1 && lab[i + w] !== best);
      if (edge) px[i * 4 + 3] = Math.min(px[i * 4 + 3], 150);
    }
    cx.putImageData(data, 0, 0);

    // Outline (convex hull of the wood) for overlap checks, in crop coords.
    var pts = [];
    for (y = y0; y <= y1; y++) {
      var lx = -1, rx = -1;
      for (x = x0; x <= x1; x++) if (lab[y * w + x] === best) { if (lx < 0) lx = x; rx = x; }
      if (lx >= 0) { pts.push([lx - x0, y - y0]); pts.push([rx - x0 + 1, y - y0]); }
    }
    var hull = convexHull(pts);

    // Crop; lay the long side horizontally so it maps onto the piece's length.
    var rot = bh > bw * 1.05;
    var ow = rot ? bh : bw, oh = rot ? bw : bh;
    hull = hull.map(function (q) { var X = rot ? bh - q[1] : q[0], Y = rot ? q[0] : q[1]; return [X / ow - 0.5, Y / oh - 0.5]; });
    var out = document.createElement('canvas');
    out.width = rot ? bh : bw; out.height = rot ? bw : bh;
    var oc = out.getContext('2d');
    if (rot) { oc.translate(bh, 0); oc.rotate(Math.PI / 2); }
    oc.drawImage(cv, x0, y0, bw, bh, 0, 0, bw, bh);
    return new Promise(function (res) {
      out.toBlob(function (blob) { res(blob ? { url: URL.createObjectURL(blob), hull: hull } : null); }, 'image/png');
    });
  }

  function convexHull(P) {
    P = P.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (i = P.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop(); up.push(P[i]); }
    var H = lo.slice(0, -1).concat(up.slice(0, -1));
    if (H.length > 48) { var step = H.length / 48, T = []; for (i = 0; i < 48; i++) T.push(H[Math.floor(i * step)]); H = T; }
    return H;
  }

  /* ---------- designer ---------- */
  function Designer(root) {
    this.root = root;
    var d = root.dataset;
    this.cfg = {
      cookies: d.cookiesCollection || '',
      slabs: d.slabsCollection || '',
      epoxyUrl: d.epoxyUrl || '',
      moneyFormat: d.moneyFormat || '${{amount}}',
      cartUrl: d.cartUrl || '/cart',
      root: d.rootUrl || '/'
    };
    this.state = {
      step: 1, shape: 'rect', L: 72, W: 36, T: 2.25, kind: 'both', resin: 'clear',
      photos: true, placed: [], selected: null, sort: 'size', q: ''
    };
    this.pieces = {}; // variantId -> piece
    this.list = [];
    this.loaded = false;
    this.build();
    this.watchResize();
    this.restoreFromHash();
    this.load();
  }

  Designer.prototype.load = function () {
    var self = this;
    var jobs = [];
    if (this.cfg.cookies) jobs.push(this.fetchAll(this.cfg.cookies, 'cookie'));
    if (this.cfg.slabs) jobs.push(this.fetchAll(this.cfg.slabs, 'slab'));
    Promise.all(jobs).then(function () {
      self.list = Object.keys(self.pieces).map(function (k) { return self.pieces[k]; });
      self.loaded = true;
      // drop restored placements that sold since the link was made
      var before = self.state.placed.length;
      self.state.placed = self.state.placed.filter(function (p) { return self.pieces[p.id]; });
      if (before && before !== self.state.placed.length) self.toast((before - self.state.placed.length) + ' piece(s) from this saved design have sold and were removed.');
      self.render();
    }).catch(function () {
      self.loaded = true;
      self.loadError = true;
      self.render();
    });
  };

  Designer.prototype.fetchAll = function (handle, kind) {
    var self = this, page = 1;
    function next() {
      return fetch(self.cfg.root.replace(/\/$/, '') + '/collections/' + encodeURIComponent(handle) + '/products.json?limit=250&page=' + page)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) {
          (data.products || []).forEach(function (pr) {
            if (!pr.variants || pr.variants.length !== 1) return;
            var v = pr.variants[0];
            if (!v.available || !isSinglePiece(pr.title)) return;
            var dims = parseDims(pr.title);
            if (!dims) return;
            if (self.pieces[v.id]) return; // in both collections; first wins
            self.pieces[v.id] = {
              id: v.id, handle: pr.handle, title: pr.title, sku: v.sku || '',
              price: Math.round(parseFloat(v.price) * 100),
              img: pr.images && pr.images[0] ? pr.images[0].src : '',
              cutSrc: (function () { var c = (pr.images || []).filter(function (im) { return /cutout/i.test(im.src); })[0]; return c ? c.src : ''; })(),
              L: dims.L, W: dims.W, T: dims.T,
              kind: kindOf(pr.title, kind)
            };
          });
          if ((data.products || []).length === 250 && page < 8) { page++; return next(); }
        });
    }
    return next();
  };

  /* ---------- layout ---------- */
  Designer.prototype.build = function () {
    var r = this.root;
    r.innerHTML = '';
    this.stepsEl = el('ol', { class: 'rtd-steps' });
    this.panel = el('div', { class: 'rtd-panel' });
    this.toastEl = el('div', { class: 'rtd-toast', role: 'status', 'aria-live': 'polite' });
    r.appendChild(this.stepsEl);
    r.appendChild(this.panel);
    r.appendChild(this.toastEl);
    this.render();
  };

  Designer.prototype.go = function (n) { this.state.step = n; this.render(); this.root.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  Designer.prototype.render = function () {
    var s = this.state, self = this;
    var names = ['Size & shape', 'Thickness', 'Wood', 'Design your top'];
    this.stepsEl.innerHTML = '';
    names.forEach(function (n, i) {
      var li = el('li', { class: 'rtd-step' + (s.step === i + 1 ? ' is-active' : '') + (s.step > i + 1 ? ' is-done' : '') }, [
        el('button', { type: 'button', onclick: function () { self.go(i + 1); }, 'aria-current': s.step === i + 1 ? 'step' : null }, [
          el('span', { class: 'rtd-step__n', text: String(i + 1) }), el('span', { class: 'rtd-step__t', text: n })
        ])
      ]);
      self.stepsEl.appendChild(li);
    });
    this.panel.innerHTML = '';
    if (s.step === 1) this.renderSize();
    else if (s.step === 2) this.renderThickness();
    else if (s.step === 3) this.renderKind();
    else this.renderDesign();
  };

  function choice(label, sub, active, onclick, extraClass) {
    return el('button', { type: 'button', class: 'rtd-choice' + (active ? ' is-active' : '') + (extraClass ? ' ' + extraClass : ''), 'aria-pressed': active ? 'true' : 'false', onclick: onclick }, [
      el('span', { class: 'rtd-choice__label', text: label }), sub ? el('span', { class: 'rtd-choice__sub', text: sub }) : null
    ]);
  }
  function nav(self, back, next, nextLabel) {
    return el('div', { class: 'rtd-nav' }, [
      back ? el('button', { type: 'button', class: 'btn btn--secondary rtd-btn-ghost', text: 'Back', onclick: function () { self.go(back); } }) : el('span'),
      el('button', { type: 'button', class: 'btn', text: nextLabel || 'Next', onclick: function () { self.go(next); } })
    ]);
  }

  Designer.prototype.renderSize = function () {
    var s = this.state, self = this;
    var shapeRow = el('div', { class: 'rtd-choices rtd-choices--2' }, [
      choice('Rectangle', 'Dining, coffee, desk', s.shape === 'rect', function () { if (s.shape !== 'rect') { s.shape = 'rect'; s.L = 72; s.W = 36; } self.render(); }),
      choice('Round', 'Side, café, round dining', s.shape === 'round', function () { if (s.shape !== 'round') { s.shape = 'round'; s.L = s.W = 44; } self.render(); })
    ]);
    var presets = el('div', { class: 'rtd-choices' });
    PRESETS[s.shape].forEach(function (p) {
      var dim = s.shape === 'round' ? fmtIn(p.L) + ' diameter' : fmtIn(p.L) + ' × ' + fmtIn(p.W);
      presets.appendChild(choice(p.label, dim, s.L === p.L && s.W === p.W, function () { s.L = p.L; s.W = p.W; self.render(); }));
    });
    function numInput(lbl, key) {
      var inp = el('input', { type: 'number', min: '12', max: '144', step: '1', value: String(s[key]), inputmode: 'decimal' });
      inp.addEventListener('change', function () {
        var v = Math.max(12, Math.min(144, parseFloat(inp.value) || s[key]));
        s[key] = v; if (s.shape === 'round') { s.L = s.W = v; } else if (s.W > s.L) { var t = s.L; s.L = s.W; s.W = t; }
        self.render();
      });
      return el('label', { class: 'rtd-field' }, [el('span', { text: lbl }), el('span', { class: 'rtd-field__in' }, [inp, el('i', { text: 'in' })])]);
    }
    var custom = el('div', { class: 'rtd-custom' }, s.shape === 'round'
      ? [numInput('Diameter', 'L')]
      : [numInput('Length', 'L'), numInput('Width', 'W')]);

    this.panel.appendChild(el('div', { class: 'rtd-q' }, [
      el('h3', { class: 'rtd-h', text: 'What shape is your table?' }), shapeRow,
      el('h3', { class: 'rtd-h', text: 'How big?' }), presets,
      el('p', { class: 'rtd-muted', text: 'Or enter an exact finished size:' }), custom,
      nav(this, 0, 2)
    ]));
  };

  Designer.prototype.renderThickness = function () {
    var s = this.state, self = this;
    var row = el('div', { class: 'rtd-choices' });
    THICKNESSES.forEach(function (t) {
      row.appendChild(choice(fmtIn(t), '', s.T === t, function () { s.T = t; self.render(); }));
    });
    this.panel.appendChild(el('div', { class: 'rtd-q' }, [
      el('h3', { class: 'rtd-h', text: 'Unfinished Thickness?' }),
      row, nav(this, 1, 3)
    ]));
  };

  Designer.prototype.renderKind = function () {
    var s = this.state, self = this;
    var row = el('div', { class: 'rtd-choices rtd-choices--3' }, [
      choice('Cookies', 'Round cross-cut slices with bark rings', s.kind === 'cookie', function () { s.kind = 'cookie'; self.render(); }),
      choice('Slabs', 'Long live-edge boards, classic river tables', s.kind === 'slab', function () { s.kind = 'slab'; self.render(); }),
      choice('Mix of both', 'Show me everything that fits', s.kind === 'both', function () { s.kind = 'both'; self.render(); })
    ]);
    var resin = el('div', { class: 'rtd-swatches' });
    RESINS.forEach(function (r) {
      resin.appendChild(el('button', { type: 'button', class: 'rtd-swatch' + (s.resin === r.id ? ' is-active' : ''), 'aria-pressed': s.resin === r.id ? 'true' : 'false', onclick: function () { s.resin = r.id; self.render(); } }, [
        el('span', { class: 'rtd-swatch__chip', style: 'background:' + r.fill }), el('span', { text: r.name })
      ]));
    });
    this.panel.appendChild(el('div', { class: 'rtd-q' }, [
      el('h3', { class: 'rtd-h', text: 'Cookies or slabs?' }), row,
      el('h3', { class: 'rtd-h', text: 'Resin color for the sketch' }), resin,
      nav(this, 2, 4, 'Start designing')
    ]));
  };

  /* ---------- design workspace ---------- */
  Designer.prototype.available = function () {
    var s = this.state, q = s.q.trim().toLowerCase();
    var placedIds = {};
    s.placed.forEach(function (p) { placedIds[p.id] = 1; });
    var maxDim = Math.max(s.L, s.W) * 1.15;
    var out = this.list.filter(function (p) {
      if (s.kind !== 'both' && p.kind !== s.kind) return false;
      if (p.T + 0.001 < s.T) return false;
      if (p.W > maxDim) return false;
      if (q && (p.sku + ' ' + p.title).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    out.sort(function (a, b) {
      if (s.sort === 'price') return a.price - b.price;
      if (s.sort === 'price-desc') return b.price - a.price;
      return b.L * b.W - a.L * a.W;
    });
    return { list: out, placedIds: placedIds };
  };

  Designer.prototype.renderDesign = function () {
    var s = this.state, self = this;
    var resin = RESINS.filter(function (r) { return r.id === s.resin; })[0] || RESINS[0];

    // toolbar
    var tableLbl = s.shape === 'round' ? fmtIn(s.L) + ' round' : fmtIn(s.L) + ' × ' + fmtIn(s.W);
    this.toolbar = el('div', { class: 'rtd-toolbar' }, [
      el('div', { class: 'rtd-toolbar__spec' }, [
        el('strong', { text: tableLbl }), el('span', { text: ' · ' + fmtIn(s.T) + ' thick · ' + resin.name + ' resin' }),
        el('button', { type: 'button', class: 'rtd-link', text: 'Change', onclick: function () { self.go(1); } })
      ]),
      el('div', { class: 'rtd-toolbar__tools' }, [
        this.toolBtn('⟲', 'Rotate left 15°', function () { self.rotateSel(-15); }),
        this.toolBtn('⟳', 'Rotate right 15°', function () { self.rotateSel(15); }),
        this.toolBtn('90°', 'Rotate 90°', function () { self.rotateSel(90); }),
        this.toolBtn('✕', 'Remove from table', function () { self.removeSel(); }),
        el('label', { class: 'rtd-toggle' }, [
          (function () { var c = el('input', { type: 'checkbox' }); c.checked = s.photos; c.addEventListener('change', function () { s.photos = c.checked; self.drawTable(); }); return c; })(),
          el('span', { text: 'Photos' })
        ])
      ])
    ]);

    this.svgWrap = el('div', { class: 'rtd-canvas' });
    this.stats = el('div', { class: 'rtd-stats' });
    this.summary = el('div', { class: 'rtd-summary' });

    var stage = el('div', { class: 'rtd-stage' }, [this.toolbar, this.svgWrap,
      el('p', { class: 'rtd-hint', text: 'Drag pieces to move them. Drag the round handle, or use the buttons, to rotate. Anything past the edge gets trimmed off when the top is cut to size.' }),
      this.stats, this.summary]);

    // picker
    var search = el('input', { type: 'search', placeholder: 'Search SKU, e.g. T476', value: s.q, 'aria-label': 'Search pieces' });
    search.addEventListener('input', function () { s.q = search.value; self.drawList(); });
    var sort = el('select', { 'aria-label': 'Sort pieces' }, [
      el('option', { value: 'size', text: 'Largest first' }),
      el('option', { value: 'price', text: 'Price: low to high' }),
      el('option', { value: 'price-desc', text: 'Price: high to low' })
    ]);
    sort.value = s.sort;
    sort.addEventListener('change', function () { s.sort = sort.value; self.drawList(); });
    this.listEl = el('div', { class: 'rtd-list' });
    this.listCount = el('p', { class: 'rtd-muted rtd-list__count' });
    var picker = el('aside', { class: 'rtd-picker' }, [
      el('h3', { class: 'rtd-h rtd-h--sm', text: 'Pieces in stock' }),
      el('div', { class: 'rtd-picker__filters' }, [search, sort]),
      this.listCount, this.listEl
    ]);

    this.panel.appendChild(el('div', { class: 'rtd-design' }, [stage, picker]));
    this.drawTable();
    this.drawList();
  };

  Designer.prototype.toolBtn = function (txt, label, fn) {
    return el('button', { type: 'button', class: 'rtd-tool', 'aria-label': label, title: label, text: txt, onclick: fn });
  };

  Designer.prototype.drawList = function () {
    var self = this, s = this.state;
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    if (!this.loaded) { this.listCount.textContent = 'Loading pieces…'; return; }
    if (this.loadError) { this.listCount.textContent = 'We couldn’t load inventory. Please refresh the page.'; return; }
    var av = this.available();
    this.listCount.textContent = av.list.length + ' piece' + (av.list.length === 1 ? '' : 's') + ' at ' + fmtIn(s.T) + ' or thicker';
    if (!av.list.length) {
      this.listEl.appendChild(el('p', { class: 'rtd-empty', text: 'Nothing matches right now. Try a thinner top, or switch between cookies and slabs.' }));
      return;
    }
    av.list.forEach(function (p) {
      var on = !!av.placedIds[p.id];
      var card = el('div', { class: 'rtd-card' + (on ? ' is-on' : '') }, [
        el('div', { class: 'rtd-card__img' }, [p.img ? el('img', { src: imgUrl(p.img, 240), alt: p.title, loading: 'lazy', width: '120', height: '120' }) : null]),
        el('div', { class: 'rtd-card__body' }, [
          el('div', { class: 'rtd-card__top' }, [
            el('strong', { text: p.sku || 'No SKU' }),
            el('span', { class: 'rtd-card__price', text: money(p.price, self.cfg.moneyFormat) })
          ]),
          el('span', { class: 'rtd-card__dims', text: fmtIn(p.L) + ' × ' + fmtIn(p.W) + ' × ' + fmtIn(p.T) + ' · ' + (p.kind === 'cookie' ? 'Cookie' : 'Slab') }),
          el('div', { class: 'rtd-card__actions' }, [
            on
              ? el('button', { type: 'button', class: 'rtd-mini is-on', text: 'On table — remove', onclick: function () { self.remove(p.id); } })
              : el('button', { type: 'button', class: 'rtd-mini', text: 'Add to table', onclick: function () { self.add(p.id); } }),
            el('a', { class: 'rtd-link', href: self.cfg.root.replace(/\/$/, '') + '/products/' + p.handle, target: '_blank', rel: 'noopener', text: 'Photos' })
          ])
        ])
      ]);
      self.listEl.appendChild(card);
    });
  };

  Designer.prototype.add = function (id) {
    var p = this.pieces[id], s = this.state;
    if (!p) return;
    // Lay long side along the table's length; find an open-ish spot.
    var pl = { id: id, x: s.L / 2, y: s.W / 2, rot: 0 };
    var best = null, bestScore = Infinity, step = Math.max(2, Math.min(s.L, s.W) / 12);
    for (var y = p.W / 2; y <= s.W - p.W / 2 + 0.01; y += step) {
      for (var x = p.L / 2; x <= s.L - p.L / 2 + 0.01; x += step) {
        var cand = { id: id, x: x, y: y, rot: 0 };
        var pen = this.penetration(cand);
        var score = pen * 100 + this.outside(cand) * 4 + Math.hypot(x - s.L / 2, y - s.W / 2) * 0.01 + x * 0.001;
        if (score < bestScore) { bestScore = score; best = cand; }
      }
    }
    if (best) pl = best;
    s.placed.push(pl);
    s.selected = id;
    this.drawTable();
    this.drawList();
  };
  Designer.prototype.outside = function (cand) { // how many outline points hang past the edge
    var s = this.state, n = 0;
    worldPoly(this.pieces[cand.id], cand).forEach(function (q) {
      if (s.shape === 'round') { if (Math.hypot(q[0] - s.L / 2, q[1] - s.W / 2) > s.L / 2 + 0.5) n++; }
      else if (q[0] < -0.5 || q[0] > s.L + 0.5 || q[1] < -0.5 || q[1] > s.W + 0.5) n++;
    });
    return n;
  };
  Designer.prototype.penetration = function (cand) {
    var me = worldPoly(this.pieces[cand.id], cand), tot = 0, self = this;
    this.state.placed.forEach(function (o) {
      if (o.id === cand.id) return;
      tot += overlap(me, worldPoly(self.pieces[o.id], o));
    });
    return tot;
  };
  Designer.prototype.remove = function (id) {
    this.state.placed = this.state.placed.filter(function (p) { return p.id !== id; });
    if (this.state.selected === id) this.state.selected = null;
    this.drawTable(); this.drawList();
  };
  Designer.prototype.removeSel = function () { if (this.state.selected) this.remove(this.state.selected); else this.toast('Tap a piece on the table first.'); };
  Designer.prototype.selPlacement = function () {
    var id = this.state.selected;
    return this.state.placed.filter(function (p) { return p.id === id; })[0];
  };
  Designer.prototype.rotateSel = function (deg) {
    var pl = this.selPlacement();
    if (!pl) { this.toast('Tap a piece on the table first.'); return; }
    pl.rot = ((pl.rot + deg) % 360 + 360) % 360;
    this.drawTable();
  };

  Designer.prototype.tableShape = function (attrs) {
    var s = this.state;
    if (s.shape === 'round') return svg('circle', Object.assign({ cx: s.L / 2, cy: s.W / 2, r: s.L / 2 }, attrs || {}));
    return svg('rect', Object.assign({ x: 0, y: 0, width: s.L, height: s.W, rx: Math.min(s.L, s.W) * 0.01 }, attrs || {}));
  };

  Designer.prototype.drawTable = function () {
    var s = this.state, self = this;
    if (!this.svgWrap) return;
    var resin = RESINS.filter(function (r) { return r.id === s.resin; })[0] || RESINS[0];
    var m = Math.max(s.L, s.W) * 0.09;
    // On phones, stand long tables up vertically so they fill the screen width.
    var portrait = this.svgWrap.clientWidth < 600 && s.shape === 'rect' && s.L > s.W * 1.3;
    this.portrait = portrait;
    var root = svg('svg', {
      viewBox: portrait
        ? (-m) + ' ' + (-m) + ' ' + (s.W + 2 * m) + ' ' + (s.L + 2 * m)
        : (-m) + ' ' + (-m) + ' ' + (s.L + 2 * m) + ' ' + (s.W + 2 * m),
      class: 'rtd-svg' + (portrait ? ' is-portrait' : ''), role: 'img', 'aria-label': 'Table sketch'
    });
    this.svgEl = root;
    var outer = root;
    root = svg('g', { class: 'rtd-world', transform: portrait ? 'translate(' + s.W + ' 0) rotate(90)' : '' });
    outer.appendChild(root);
    this.worldEl = root;
    var textRot = portrait ? -90 : 0;
    var defs = svg('defs');
    var clip = svg('clipPath', { id: 'rtd-clip-' + this.uid() });
    clip.appendChild(this.tableShape());
    defs.appendChild(clip);
    root.appendChild(defs);

    // background click clears selection
    var bg = svg('rect', { x: -m, y: -m, width: s.L + 2 * m, height: s.W + 2 * m, fill: 'transparent' });
    bg.addEventListener('pointerdown', function () { s.selected = null; self.drawTable(); });
    root.appendChild(bg);

    root.appendChild(this.tableShape({ fill: resin.fill, stroke: resin.edge, 'stroke-width': Math.max(s.L, s.W) * 0.004, class: 'rtd-table' }));

    // grid every 6"
    var grid = svg('g', { 'clip-path': 'url(#' + clip.id + ')', class: 'rtd-grid', 'pointer-events': 'none' });
    var gc = resin.id === 'black' || resin.id === 'green' || resin.id === 'ocean' || resin.id === 'smoke' ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
    for (var gx = 6; gx < s.L; gx += 6) grid.appendChild(svg('line', { x1: gx, y1: 0, x2: gx, y2: s.W, stroke: gc, 'stroke-width': 0.12 }));
    for (var gy = 6; gy < s.W; gy += 6) grid.appendChild(svg('line', { x1: 0, y1: gy, x2: s.L, y2: gy, stroke: gc, 'stroke-width': 0.12 }));
    root.appendChild(grid);

    // conflicts
    var conflicts = {};
    for (var i = 0; i < s.placed.length; i++) for (var j = i + 1; j < s.placed.length; j++) {
      var A = s.placed[i], B = s.placed[j];
      if (overlap(worldPoly(this.pieces[A.id], A), worldPoly(this.pieces[B.id], B)) > 0.15) { conflicts[A.id] = conflicts[B.id] = 1; }
    }
    this.conflicts = conflicts;

    var ghosts = svg('g', { class: 'rtd-ghosts' });
    var inside = svg('g', { 'clip-path': 'url(#' + clip.id + ')' });
    var overlays = svg('g', { class: 'rtd-overlays' });
    root.appendChild(ghosts); root.appendChild(inside); root.appendChild(overlays);
    var fs = Math.max(1.1, Math.min(s.L, s.W) * 0.035);

    s.placed.forEach(function (pl) {
      var p = self.pieces[pl.id];
      if (!p) return;
      var tf = 'translate(' + pl.x + ' ' + pl.y + ') rotate(' + pl.rot + ')';
      function pieceShape(extra) {
        var a = (p.cut && s.photos && p.hull)
          ? svg('polygon', { points: localPoly(p).map(function (q) { return q[0].toFixed(2) + ',' + q[1].toFixed(2); }).join(' ') })
          : p.kind === 'cookie'
          ? svg('ellipse', { cx: 0, cy: 0, rx: p.L / 2, ry: p.W / 2 })
          : svg('rect', { x: -p.L / 2, y: -p.W / 2, width: p.L, height: p.W, rx: Math.min(p.L, p.W) * 0.08 });
        for (var k in extra) a.setAttribute(k, extra[k]);
        return a;
      }
      if (s.photos) self.ensureCutout(p);
      var useCut = s.photos && p.cut;
      function body(group, faded) {
        var g = svg('g', { transform: tf, opacity: faded ? 0.28 : 1 });
        if (useCut) {
          var ci = svg('image', { href: p.cut, x: -p.L / 2, y: -p.W / 2, width: p.L, height: p.W, preserveAspectRatio: 'none', class: 'rtd-cut' });
          g.appendChild(ci);
          group.appendChild(g);
          return g;
        }
        g.appendChild(pieceShape({ fill: '#8a6a45', stroke: '#4d3a24', 'stroke-width': 0.18 }));
        if (s.photos && p.img) {
          var cid = 'rtd-pc-' + pl.id + (faded ? 'g' : '');
          var pc = svg('clipPath', { id: cid });
          pc.appendChild(pieceShape());
          defs.appendChild(pc);
          var im = svg('image', { href: imgUrl(p.img, 500), x: -p.L / 2, y: -p.W / 2, width: p.L, height: p.W, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#' + cid + ')' });
          im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', imgUrl(p.img, 500));
          g.appendChild(im);
        } else {
          // simple wood rings for outline mode
          for (var rr = 0.8; rr > 0.1; rr -= 0.22) g.appendChild(pieceShape({ fill: 'none', stroke: 'rgba(60,40,20,.35)', 'stroke-width': 0.15, transform: 'scale(' + rr + ')' }));
        }
        group.appendChild(g);
        return g;
      }
      body(ghosts, true);
      var main = body(inside, false);
      main.classList.add('rtd-piece');

      // outline + label + hit target (unclipped so you can grab overhang)
      var sel = s.selected === pl.id, bad = conflicts[pl.id];
      var hit = svg('g', { transform: tf, class: 'rtd-hit' + (sel ? ' is-sel' : '') + (bad ? ' is-bad' : ''), tabindex: '0', role: 'button', 'aria-label': (p.sku || p.title) + ', ' + fmtIn(p.L) + ' by ' + fmtIn(p.W) });
      if (useCut) {
        hit.appendChild(pieceShape({ fill: 'transparent', stroke: bad ? '#d93025' : 'none', 'stroke-width': 0.45, 'stroke-dasharray': '1 0.6' }));
        if (sel && !bad) hit.appendChild(pieceShape({ fill: 'none', stroke: '#fff', 'stroke-width': 0.35 }));
        if (sel) hit.appendChild(pieceShape({ fill: 'none', stroke: '#111', 'stroke-width': 0.18, 'stroke-dasharray': '0.8 0.8' }));
      } else {
        hit.appendChild(pieceShape({ fill: 'transparent', stroke: bad ? '#d93025' : (sel ? '#ffffff' : 'rgba(0,0,0,.35)'), 'stroke-width': sel || bad ? 0.45 : 0.15, 'stroke-dasharray': bad ? '1 0.6' : 'none', 'vector-effect': 'none' }));
        if (sel) hit.appendChild(pieceShape({ fill: 'none', stroke: '#111', 'stroke-width': 0.15, transform: 'scale(1.0)', 'stroke-dasharray': '0.8 0.8' }));
      }
      var label = svg('text', { x: 0, y: fs * 0.35, 'text-anchor': 'middle', 'font-size': fs, class: 'rtd-label', transform: 'rotate(' + (-pl.rot + textRot) + ')' });
      label.textContent = p.sku || '';
      hit.appendChild(label);
      overlays.appendChild(hit);
      self.bindDrag(hit, pl);

      if (sel) {
        var r = pl.rot * Math.PI / 180, dist = p.W / 2 + fs * 1.6;
        var hx = pl.x + Math.sin(r) * dist, hy = pl.y - Math.cos(r) * dist;
        overlays.appendChild(svg('line', { x1: pl.x + Math.sin(r) * (p.W / 2), y1: pl.y - Math.cos(r) * (p.W / 2), x2: hx, y2: hy, stroke: '#111', 'stroke-width': 0.2 }));
        var h = svg('circle', { cx: hx, cy: hy, r: fs * 0.75, class: 'rtd-handle', fill: '#fff', stroke: '#111', 'stroke-width': 0.25 });
        overlays.appendChild(h);
        self.bindRotate(h, pl);
      }
    });

    // dimension labels
    var dl = svg('g', { class: 'rtd-dims', 'font-size': fs * 0.9, 'pointer-events': 'none' });
    var t1 = svg('text', { x: s.L / 2, y: -m * 0.35, 'text-anchor': 'middle', transform: textRot ? 'rotate(-90 ' + (s.L / 2) + ' ' + (-m * 0.35) + ')' : '' });
    t1.textContent = s.shape === 'round' ? fmtIn(s.L) + ' diameter' : fmtIn(s.L);
    dl.appendChild(t1);
    if (s.shape !== 'round') {
      var t2 = svg('text', { x: -m * 0.35, y: s.W / 2, 'text-anchor': 'middle', transform: textRot ? '' : 'rotate(-90 ' + (-m * 0.35) + ' ' + (s.W / 2) + ')' });
      t2.textContent = fmtIn(s.W);
      dl.appendChild(t2);
    }
    root.appendChild(dl);

    this.svgWrap.innerHTML = '';
    this.svgWrap.appendChild(outer);
    if (s.placed.length === 0) {
      this.svgWrap.appendChild(el('div', { class: 'rtd-empty-overlay' }, [el('p', { text: this.loaded ? 'Pick pieces from the list to lay them on your table.' : 'Loading pieces…' })]));
    }
    this.updateStats();
    this.saveHash();
  };

  Designer.prototype.watchResize = function () {
    var self = this, t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (self.state.step !== 4 || !self.svgWrap) return;
        var want = self.svgWrap.clientWidth < 600 && self.state.shape === 'rect' && self.state.L > self.state.W * 1.3;
        if (want !== self.portrait) self.drawTable();
      }, 150);
    });
  };

  Designer.prototype.ensureCutout = function (p) {
    var self = this;
    if (!p || !p.img || p.cutState) return;
    p.cutState = 'loading';
    makeCutout(imgUrl(p.cutSrc || p.img, CUT_SIZE)).then(function (r) {
      p.cut = r ? r.url : null; p.hull = r ? r.hull : null; p.cutState = r ? 'ok' : 'failed';
      if (r && self.state.placed.some(function (pl) { return pl.id === p.id; })) {
        if (self.dragging) self.pendingRedraw = true; else self.drawTable();
      }
    });
  };

  Designer.prototype.uid = function () { if (!this._uid) this._uid = Math.random().toString(36).slice(2, 8); return this._uid; };

  Designer.prototype.toLocal = function (evt) {
    var pt = this.svgEl.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(this.worldEl.getScreenCTM().inverse());
  };

  Designer.prototype.bindDrag = function (node, pl) {
    var self = this;
    node.addEventListener('keydown', function (e) {
      var k = e.key, d = e.shiftKey ? 3 : 0.5, used = true;
      if (k === 'ArrowLeft') pl.x -= d; else if (k === 'ArrowRight') pl.x += d;
      else if (k === 'ArrowUp') pl.y -= d; else if (k === 'ArrowDown') pl.y += d;
      else if (k === 'r' || k === 'R') pl.rot = (pl.rot + (e.shiftKey ? -15 : 15) + 360) % 360;
      else if (k === 'Delete' || k === 'Backspace') { self.remove(pl.id); return; }
      else used = false;
      if (used) { e.preventDefault(); self.state.selected = pl.id; self.drawTable(); var n = self.svgEl.querySelector('.rtd-hit.is-sel'); if (n) n.focus(); }
    });
    node.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var start = self.toLocal(e), ox = pl.x, oy = pl.y, moved = false;
      self.dragging = true;
      if (self.state.selected !== pl.id) { self.state.selected = pl.id; self.drawTable(); }
      var raf = 0;
      function move(ev) {
        var p = self.toLocal(ev);
        pl.x = Math.round((ox + p.x - start.x) * 4) / 4;
        pl.y = Math.round((oy + p.y - start.y) * 4) / 4;
        // keep at least part of the piece on the table
        pl.x = Math.max(-2, Math.min(self.state.L + 2, pl.x));
        pl.y = Math.max(-2, Math.min(self.state.W + 2, pl.y));
        moved = true;
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; self.fastMove(pl); });
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        self.dragging = false;
        if (moved || self.pendingRedraw) { self.pendingRedraw = false; self.drawTable(); }
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  };

  // While dragging, just move the transforms instead of rebuilding the SVG.
  Designer.prototype.fastMove = function (pl) {
    var idx = this.state.placed.indexOf(pl);
    var tf = 'translate(' + pl.x + ' ' + pl.y + ') rotate(' + pl.rot + ')';
    var groups = [this.svgEl.querySelectorAll('.rtd-ghosts > g')[idx], this.svgEl.querySelectorAll('.rtd-piece')[idx], this.svgEl.querySelectorAll('.rtd-hit')[idx]];
    groups.forEach(function (g) { if (g) g.setAttribute('transform', tf); });
    var ov = this.svgEl.querySelector('.rtd-overlays');
    if (ov) { var h = ov.querySelector('.rtd-handle'); if (h) { h.style.display = 'none'; if (h.previousSibling && h.previousSibling.tagName === 'line') h.previousSibling.style.display = 'none'; } }
  };

  Designer.prototype.bindRotate = function (node, pl) {
    var self = this;
    node.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      self.dragging = true;
      var raf = 0;
      function move(ev) {
        var p = self.toLocal(ev);
        var ang = Math.atan2(p.x - pl.x, -(p.y - pl.y)) * 180 / Math.PI;
        if (!ev.shiftKey) ang = Math.round(ang / 5) * 5;
        pl.rot = (ang + 360) % 360;
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; self.fastMove(pl); });
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        self.dragging = false; self.pendingRedraw = false;
        self.drawTable();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  };

  /* ---------- stats, resin estimate, cart ---------- */
  Designer.prototype.coverage = function () {
    var s = this.state, self = this, res = Math.max(0.5, Math.max(s.L, s.W) / 160);
    var polys = s.placed.map(function (pl) { return worldPoly(self.pieces[pl.id], pl); });
    var boxes = polys.map(function (P) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      P.forEach(function (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
      return [x0, y0, x1, y1];
    });
    var total = 0, wood = 0, cx = s.L / 2, cy = s.W / 2, R = s.L / 2;
    for (var y = res / 2; y < s.W; y += res) for (var x = res / 2; x < s.L; x += res) {
      if (s.shape === 'round' && Math.hypot(x - cx, y - cy) > R) continue;
      total++;
      for (var i = 0; i < polys.length; i++) {
        var b = boxes[i];
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        if (inConvex(polys[i], x, y)) { wood++; break; }
      }
    }
    var cell = res * res;
    return { tableArea: total * cell, woodArea: wood * cell };
  };

  Designer.prototype.updateStats = function () {
    var s = this.state, self = this;
    if (!this.stats) return;
    var c = this.coverage();
    var pct = c.tableArea ? Math.round(c.woodArea / c.tableArea * 100) : 0;
    var resinArea = Math.max(0, c.tableArea - c.woodArea);
    var gal = resinArea * s.T / IN3_PER_GALLON * 1.1; // +10% for mold seepage & mixing loss
    var subtotal = s.placed.reduce(function (a, pl) { return a + (self.pieces[pl.id] ? self.pieces[pl.id].price : 0); }, 0);
    var nConf = Object.keys(this.conflicts || {}).length;

    function stat(label, value, note) {
      return el('div', { class: 'rtd-stat' }, [el('span', { class: 'rtd-stat__l', text: label }), el('strong', { class: 'rtd-stat__v', text: value }), note ? el('span', { class: 'rtd-stat__n', text: note }) : null]);
    }
    this.stats.innerHTML = '';
    this.stats.appendChild(stat('Wood coverage', pct + '%', pct < 35 ? 'Lots of resin' : pct > 80 ? 'Mostly wood' : ''));
    this.stats.appendChild(stat('Resin to pour', s.placed.length ? (Math.round(gal * 10) / 10) + ' gal' : '—', 'Estimate incl. 10% extra'));
    this.stats.appendChild(stat('Wood subtotal', money(subtotal, this.cfg.moneyFormat), s.placed.length + ' piece' + (s.placed.length === 1 ? '' : 's')));

    this.summary.innerHTML = '';
    if (nConf) this.summary.appendChild(el('p', { class: 'rtd-warn', text: 'Some pieces overlap (outlined in red). Move or rotate them apart before ordering.' }));
    var actions = el('div', { class: 'rtd-actions' }, [
      el('button', { type: 'button', class: 'btn rtd-cart', text: 'Add ' + s.placed.length + ' piece' + (s.placed.length === 1 ? '' : 's') + ' to cart', disabled: s.placed.length && !nConf ? null : 'disabled', onclick: function () { self.addToCart(this); } }),
      el('button', { type: 'button', class: 'btn btn--secondary rtd-btn-ghost', text: 'Copy link to this design', disabled: s.placed.length ? null : 'disabled', onclick: function () { self.copyLink(); } }),
      el('button', { type: 'button', class: 'btn btn--secondary rtd-btn-ghost', text: 'Download sketch', disabled: s.placed.length ? null : 'disabled', onclick: function () { self.download(); } })
    ]);
    this.summary.appendChild(actions);
    if (this.cfg.epoxyUrl && s.placed.length) {
      this.summary.appendChild(el('p', { class: 'rtd-muted' }, ['Need epoxy? ', el('a', { href: this.cfg.epoxyUrl, class: 'rtd-link', text: 'Shop deep-pour resin and pigments' }), ' — you’ll need about ' + (Math.round(gal * 10) / 10) + ' gallons for this top.']));
    }
  };

  Designer.prototype.designRef = function () {
    var s = this.state;
    return (s.shape === 'round' ? fmtIn(s.L) + ' round' : fmtIn(s.L) + 'x' + fmtIn(s.W)) + ' x ' + fmtIn(s.T) + ', ' + s.resin + ' resin';
  };
  Designer.prototype.shareUrl = function () { return location.origin + location.pathname + '#d=' + this.encode(); };
  Designer.prototype.encode = function () {
    var s = this.state;
    return b64e({ v: 1, s: s.shape, L: s.L, W: s.W, T: s.T, k: s.kind, c: s.resin, p: s.placed.map(function (p) { return [p.id, +p.x.toFixed(2), +p.y.toFixed(2), Math.round(p.rot)]; }) });
  };
  Designer.prototype.saveHash = function () {
    if (this.state.step !== 4 || !this.loaded) return;
    try { history.replaceState(null, '', '#d=' + this.encode()); } catch (_) {}
  };
  Designer.prototype.restoreFromHash = function () {
    var m = location.hash.match(/d=([A-Za-z0-9_-]+)/);
    if (!m) return;
    try {
      var o = b64d(m[1]), s = this.state;
      s.shape = o.s === 'round' ? 'round' : 'rect';
      s.L = +o.L || 72; s.W = +o.W || 36; s.T = THICKNESSES.indexOf(+o.T) > -1 ? +o.T : 2.25; s.kind = o.k || 'both'; s.resin = o.c || 'clear';
      s.placed = (o.p || []).map(function (a) { return { id: a[0], x: +a[1], y: +a[2], rot: +a[3] || 0 }; });
      s.step = 4;
      this.render();
    } catch (_) {}
  };

  Designer.prototype.copyLink = function () {
    var url = this.shareUrl(), self = this;
    function done() { self.toast('Link copied. Send it to us or save it to come back later.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link:', url); });
    else prompt('Copy this link:', url);
  };

  Designer.prototype.addToCart = function (btn) {
    var s = this.state, self = this, ref = this.designRef(), url = this.shareUrl();
    if (!s.placed.length) return;
    btn.disabled = true; btn.textContent = 'Adding…';
    var base = this.cfg.root.replace(/\/$/, '');
    fetch(base + '/cart/add.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: s.placed.map(function (p) { return { id: p.id, quantity: 1, properties: { 'Table design': ref } }; }) })
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); })
      .then(function () {
        return fetch(base + '/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attributes: { 'Table design': ref, 'Table design layout': url } }) });
      })
      .then(function () { window.location.href = self.cfg.cartUrl; })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = 'Add to cart';
        self.toast((err && (err.description || err.message)) || 'Sorry, something went wrong. One of these pieces may have just sold.');
      });
  };

  Designer.prototype.download = function () {
    var self = this, s = this.state;
    var clone = this.svgEl.cloneNode(true);
    clone.querySelectorAll('.rtd-handle').forEach(function (n) { if (n.previousSibling) n.previousSibling.remove(); n.remove(); });
    var vb = this.svgEl.viewBox.baseVal, scale = 1600 / vb.width;
    clone.setAttribute('width', 1600); clone.setAttribute('height', Math.round(vb.height * scale));
    clone.setAttribute('xmlns', SVGNS);
    var style = document.createElementNS(SVGNS, 'style');
    style.textContent = '.rtd-label{font:600 1px sans-serif;fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.6);stroke-width:.25px}.rtd-dims text{fill:#333;font-family:sans-serif}';
    clone.insertBefore(style, clone.firstChild);
    var images = clone.querySelectorAll('image');
    // Inline photos so the PNG keeps them; fall back to outline if the CDN blocks it.
    Promise.all(Array.prototype.map.call(images, function (im) {
      var href = im.getAttribute('href');
      return fetch(href).then(function (r) { return r.blob(); }).then(function (b) {
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { im.setAttribute('href', fr.result); im.removeAttributeNS('http://www.w3.org/1999/xlink', 'href'); res(); }; fr.readAsDataURL(b); });
      }).catch(function () { im.remove(); });
    })).then(function () {
      var data = new XMLSerializer().serializeToString(clone);
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement('canvas');
        cv.width = 1600; cv.height = Math.round(vb.height * scale) + 120;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = '#222'; ctx.font = '600 28px sans-serif';
        ctx.fillText('Desert Hardwoods · ' + self.designRef(), 40, cv.height - 70);
        ctx.font = '22px sans-serif';
        ctx.fillText('Pieces: ' + s.placed.map(function (p) { return self.pieces[p.id].sku; }).join(', '), 40, cv.height - 32);
        var a = document.createElement('a');
        a.download = 'resin-table-design.png';
        a.href = cv.toDataURL('image/png');
        document.body.appendChild(a); a.click(); a.remove();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
    });
  };

  Designer.prototype.toast = function (msg) {
    var t = this.toastEl;
    t.textContent = msg; t.classList.add('is-on');
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { t.classList.remove('is-on'); }, 4200);
  };

  // expose for tests
  window.RTD = { makeCutout: makeCutout, parseDims: parseDims, isSinglePiece: isSinglePiece, kindOf: kindOf, Designer: Designer };

  function init() {
    document.querySelectorAll('[data-resin-table-designer]').forEach(function (n) {
      if (!n.__rtd) n.__rtd = new Designer(n);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('shopify:section:load', init);
})();
