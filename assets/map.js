// Floor plan rendering, pan/zoom and walking routes.
import { esc, icon } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const GRID = 5;

// Renders the venue plus the event's stands, activities and facilities as SVG markup.
export function renderMapSVG(event, venue, { editable = false } = {}) {
  const [vx, vy, vw, vh] = venue.viewBox;
  const shapes = venue.shapes.map(s => {
    if (s.type === 'poly') return `<polygon class="v-${s.class}" points="${s.points}"/>`;
    let out = `<rect class="v-${s.class}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${s.room ? ` data-room="${s.room}"` : ''}/>`;
    if (s.label) {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      out += s.vertical
        ? `<text class="v-label" x="${cx}" y="${cy}" transform="rotate(-90 ${cx} ${cy})">${esc(s.label)}</text>`
        : `<text class="v-label" x="${cx}" y="${cy + (s.sub ? -2 : 4)}">${esc(s.label)}</text>`;
      if (s.sub) out += `<text class="v-sub" x="${cx}" y="${cy + 11}">${esc(s.sub)}</text>`;
    }
    return out;
  }).join('');
  const walls = venue.walls.map(p => `<polyline class="v-wall" points="${p}"/>`).join('');
  const pois = venue.pois.filter(p => !p.hidden).map(p => `
    <g class="poi" data-poi="${p.id}" transform="translate(${p.x} ${p.y})">
      ${p.label ? `<rect class="poi-label-bg" x="-46" y="10" width="92" height="22" rx="3"/><text class="poi-label" y="25">${esc(p.label)}</text>` : ''}
      <circle r="11"/>${icon(p.icon, { size: 14, x: -7, y: -7 })}<title>${esc(p.name)}</title>
    </g>`).join('');
  const stands = event.stands.map(s => standSVG(event, s, editable)).join('');
  const acts = (event.activities || []).filter(a => a.x != null).map(a => `
    <g class="act" data-act="${a.id}" transform="translate(${a.x} ${a.y})">
      <circle r="13"/>${icon(a.icon, { size: 16, x: -8, y: -8 })}<title>${esc(a.name)}</title>
    </g>`).join('');
  return `<svg class="floorplan" xmlns="${NS}" viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="Plattegrond">
    <g class="viewport">
      <g class="venue">${shapes}${walls}</g>
      <g class="stands">${stands}</g>
      <g class="route-layer"></g>
      <g class="acts">${acts}</g>
      <g class="pois">${pois}</g>
      <g class="marker-layer"></g>
    </g>
  </svg>`;
}

export function standSVG(event, s, editable) {
  const partners = partnersAtStand(event, s.label);
  const name = partners.map(p => p.name).join(', ') || (editable ? 'Geen partner gekoppeld' : '');
  if (s.kind === 'point') {
    return `<g class="stand point${partners.length ? '' : ' empty'}" data-stand="${esc(s.id)}" transform="translate(${s.x} ${s.y})">
      <circle r="10"/><text y="4">${esc(s.label)}</text><title>${esc(s.label)} · ${esc(name)}</title></g>`;
  }
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  return `<g class="stand ${s.kind}${partners.length ? '' : ' empty'}" data-stand="${esc(s.id)}">
    <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"/>
    <text x="${cx}" y="${cy + 4}">${esc(s.label)}</text>
    ${editable ? `<rect class="resize" x="${s.x + s.w - 7}" y="${s.y + s.h - 7}" width="9" height="9"/>` : ''}
    <title>${esc(s.label)} · ${esc(name)}</title></g>`;
}

export function partnersAtStand(event, label) {
  return event.partners.filter(p => p.stand && String(p.stand) === String(label));
}

export function standsOfPartner(event, partner) {
  return event.stands.filter(s => partner.stand && String(s.label) === String(partner.stand));
}

export function standCenter(s) {
  return s.kind === 'point' ? { x: s.x, y: s.y } : { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

// Pan / zoom on the SVG viewBox with mouse, wheel, touch-pinch and buttons.
export class PanZoom {
  constructor(svg, { onTap, minScale = 1, maxScale = 6, dragFilter } = {}) {
    this.svg = svg;
    this.base = svg.viewBox.baseVal;
    this.home = { x: this.base.x, y: this.base.y, w: this.base.width, h: this.base.height };
    this.view = { ...this.home };
    this.minScale = minScale; this.maxScale = maxScale;
    this.pointers = new Map();
    this.onTap = onTap;
    this.dragFilter = dragFilter || (() => true);
    svg.addEventListener('pointerdown', e => this.down(e));
    svg.addEventListener('pointermove', e => this.move(e));
    svg.addEventListener('pointerup', e => this.up(e));
    svg.addEventListener('pointercancel', e => this.up(e));
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.toSvg(e.clientX, e.clientY);
      this.zoomAt(p, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }
  toSvg(cx, cy) {
    const r = this.svg.getBoundingClientRect();
    // preserveAspectRatio meet: compute the actual drawn scale
    const s = Math.min(r.width / this.view.w, r.height / this.view.h);
    const ox = (r.width - this.view.w * s) / 2, oy = (r.height - this.view.h * s) / 2;
    return { x: this.view.x + (cx - r.left - ox) / s, y: this.view.y + (cy - r.top - oy) / s, s };
  }
  apply() {
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    this.svg.style.setProperty('--zoom', (this.home.w / v.w).toFixed(3));
  }
  clamp() {
    const v = this.view, h = this.home;
    const scale = h.w / v.w;
    if (scale < this.minScale) { v.w = h.w / this.minScale; v.h = h.h / this.minScale; }
    if (scale > this.maxScale) { v.w = h.w / this.maxScale; v.h = h.h / this.maxScale; }
    v.x = Math.min(Math.max(v.x, h.x - v.w * 0.4), h.x + h.w - v.w * 0.6);
    v.y = Math.min(Math.max(v.y, h.y - v.h * 0.4), h.y + h.h - v.h * 0.6);
  }
  zoomAt(p, f) {
    const v = this.view;
    const nw = v.w / f, nh = v.h / f;
    const scale = this.home.w / nw;
    if (scale < this.minScale * 0.999 && f < 1) return this.reset();
    if (scale > this.maxScale) return;
    v.x = p.x - (p.x - v.x) * (nw / v.w);
    v.y = p.y - (p.y - v.y) * (nh / v.h);
    v.w = nw; v.h = nh;
    this.clamp(); this.apply();
  }
  zoomBy(f) { const v = this.view; this.zoomAt({ x: v.x + v.w / 2, y: v.y + v.h / 2 }, f); }
  reset() { this.view = { ...this.home }; this.apply(); }
  focus(points, scale = 2.5) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const pad = 50;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const ratio = this.home.w / this.home.h;
    let w = points.length === 1 ? this.home.w / scale : Math.max(x1 - x0, (y1 - y0) * ratio);
    w = Math.min(Math.max(w, this.home.w / this.maxScale), this.home.w);
    const h = w / ratio;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.view = { x: cx - w / 2, y: cy - h / 2, w, h };
    this.clamp(); this.animate();
  }
  animate() {
    this.svg.classList.add('animating');
    this.apply();
    clearTimeout(this._t);
    this._t = setTimeout(() => this.svg.classList.remove('animating'), 350);
  }
  down(e) {
    if (!this.dragFilter(e)) return;
    this.svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: Date.now(), target: e.target });
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const prev = { x: p.x, y: p.y };
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 1) {
      const a = this.toSvg(prev.x, prev.y), b = this.toSvg(p.x, p.y);
      this.view.x -= b.x - a.x; this.view.y -= b.y - a.y;
      this.clamp(); this.apply();
    } else if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      const other = p1 === p ? p2 : p1;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(p.x - other.x, p.y - other.y);
      if (d0 > 0) this.zoomAt(this.toSvg((p.x + other.x) / 2, (p.y + other.y) / 2), d1 / d0);
    }
  }
  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
    if (moved < 8 && Date.now() - p.t < 500 && this.onTap) this.onTap(p.target, e);
  }
}

// Grid-based A* over the venue's walkable areas, avoiding stands and obstacles.
export class Router {
  constructor(venue, event) {
    const [vx, vy, vw, vh] = venue.viewBox;
    this.ox = vx; this.oy = vy;
    this.cols = Math.ceil(vw / GRID); this.rows = Math.ceil(vh / GRID);
    const g = new Uint8Array(this.cols * this.rows);
    // Walkable areas round inwards so thin walls between them stay closed; obstacles round outwards.
    const fill = ([x, y, w, h], val, pad = 0) => {
      const lo = val ? Math.ceil : Math.floor, hi = val ? Math.floor : Math.ceil;
      const c0 = lo((x - pad - vx) / GRID), c1 = hi((x + w + pad - vx) / GRID);
      const r0 = lo((y - pad - vy) / GRID), r1 = hi((y + h + pad - vy) / GRID);
      for (let r = Math.max(0, r0); r < Math.min(this.rows, r1); r++)
        for (let c = Math.max(0, c0); c < Math.min(this.cols, c1); c++) g[r * this.cols + c] = val;
    };
    venue.walkable.forEach(r => fill(r, 1));
    venue.obstacles.forEach(r => fill(r, 0, 2));
    event.stands.filter(s => s.kind !== 'point').forEach(s => fill([s.x, s.y, s.w, s.h], 0, 3));
    this.grid = g;
  }
  cell(p) { return { c: Math.floor((p.x - this.ox) / GRID), r: Math.floor((p.y - this.oy) / GRID) }; }
  free(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.grid[r * this.cols + c] === 1; }
  // Free cells closest to p: the first ring of free cells around it, plus one ring extra
  // so a route can arrive at whichever side of a stand faces the walker.
  nearCells(p) {
    const { c, r } = this.cell(p), out = [];
    let first = -1;
    for (let d = 0; d < 40 && (first < 0 || d <= first + 1); d++)
      for (let dr = -d; dr <= d; dr++)
        for (let dc = -d; dc <= d; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== d || !this.free(c + dc, r + dr)) continue;
          if (first < 0) first = d;
          out.push((r + dr) * this.cols + c + dc);
        }
    return out;
  }
  route(from, to) {
    const starts = this.nearCells(from), goals = new Set(this.nearCells(to));
    if (!starts.length || !goals.size) return null;
    const W = this.cols, N = W * this.rows;
    const gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1);
    const tc = this.cell(to);
    const h = i => Math.max(0, Math.hypot((i % W) - tc.c, Math.floor(i / W) - tc.r) - 3);
    const heap = new MinHeap();
    for (const s of starts) { gScore[s] = 0; heap.push(s, h(s)); }
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let goal = -1;
    while (heap.size) {
      const cur = heap.pop();
      if (goals.has(cur)) { goal = cur; break; }
      const cc = cur % W, cr = (cur - cc) / W;
      for (const [dc, dr, cost] of dirs) {
        const nc = cc + dc, nr = cr + dr;
        if (!this.free(nc, nr)) continue;
        if (dc && dr && (!this.free(cc + dc, cr) || !this.free(cc, cr + dr))) continue;
        const n = nr * W + nc, gs = gScore[cur] + cost;
        if (gs < gScore[n]) { gScore[n] = gs; came[n] = cur; heap.push(n, gs + h(n)); }
      }
    }
    if (goal < 0) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map(i => ({ x: this.ox + (i % W + 0.5) * GRID, y: this.oy + (Math.floor(i / W) + 0.5) * GRID }));
    const path = [from, ...this.smooth(pts), to];
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return { points: path, length: len };
  }
  // Remove intermediate points when there is a clear line of sight.
  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clear(pts[i], pts[j])) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  clear(a, b) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (GRID / 2));
    for (let k = 0; k <= steps; k++) {
      const { c, r } = this.cell({ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps });
      if (!this.free(c, r)) return false;
    }
    return true;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; let i = K.length; K.push(k); P.push(p);
    while (i > 0) { const j = (i - 1) >> 1; if (P[j] <= P[i]) break; [K[i], K[j]] = [K[j], K[i]]; [P[i], P[j]] = [P[j], P[i]]; i = j; }
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < K.length && P[l] < P[m]) m = l;
        if (r < K.length && P[r] < P[m]) m = r;
        if (m === i) break;
        [K[i], K[m]] = [K[m], K[i]]; [P[i], P[m]] = [P[m], P[i]]; i = m;
      }
    }
    return top;
  }
}

// Map units are 150 dpi pixels of the printed plan; the hall is roughly 45 m wide (525 units).
export const METERS_PER_UNIT = 45 / 525;
