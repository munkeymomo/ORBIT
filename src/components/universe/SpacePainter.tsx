import { isYours } from '../../host/caps';
import { useLayoutEffect, useRef } from 'react';
import { clamp, daysBetween } from '../../lib/util';
import { colorHex } from '../../lib/colors';
import { CLUTTER, clusterParticles, galaxyBeaconSpot, hashString, LOD, rng, spiralParticles, starField, systemBeaconSpot, type GalaxyPlace, type Size, type SystemPlace, type View } from './space';
import type { Beacon, Cluster, Family } from '../../host/types';
import type { MoonSet } from '../../host/adapt';
import type { Prefs } from '../../types';
import type { LabelSide, OrbitLabel } from './labels';
import { curveMid, type ArrowCurve } from './arrows';

/** Fixed space palette: the Universe is always night sky, in either app theme. */
const SPACE = {
  bg0: '#04050a',
  bg1: '#0a0c16',
  teal: '#2dd4bf',
  amber: '#f5b544',
  danger: '#f2766b',
  white: '#ffffff',
  pale: '#cfd9ff',
};

function rgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${clamp(a, 0, 1)})`;
}

/** How strongly galaxy-scale imagery shows at this zoom (fades as you enter systems). */
export function galaxyFade(k: number) {
  if (k <= 0.2) return 1;
  return 0.14 + 0.86 * Math.exp(-(k - 0.2) * 6);
}

export function SpacePainter({
  view,
  size,
  galaxies,
  dim,
  today,
  showDeps,
  universeLevel,
  dropTarget,
  draggingId,
  families = {},
  clusters = [],
  layers = { moons: true, belts: true, beacons: true },
  planetLabels,
  crowded,
  arrows = [],
  arrowFocus,
  galaxyBoxes,
  hosted = false,
}: {
  /** Hosted: ORBIT's own galaxies get a thin solid rim (the host's have the dashed survey ring). */
  hosted?: boolean;
  /** Where each galaxy's words are at universe level (a cluster's outline goes round them). */
  galaxyBoxes?: Map<string, { x: number; y: number; w: number; h: number }>;
  /** A verse's relations between planets ("made from"), as curves on screen. Never dependencies. */
  arrows?: ArrowCurve[];
  /** Planets selected or hovered: the labels of their arrows are shown. */
  arrowFocus?: Set<string>;
  /** Where each planet's name is (moons go on the other side). */
  planetLabels?: Map<string, OrbitLabel>;
  /** Galaxies and systems whose dates are too close together to label one by one. */
  crowded?: Set<string>;
  /** Hosted: family id → label and colour, for moons and belt rocks. */
  families?: Record<string, Family>;
  /** Hosted: groups of galaxies that belong together (drawn as faint constellations at universe level). */
  clusters?: Cluster[];
  layers?: Prefs['layers'];
  dropTarget: string | null;
  draggingId: string | null;
  view: View;
  size: Size;
  galaxies: GalaxyPlace[];
  dim: boolean;
  today: string;
  showDeps: boolean;
  /** At universe level systems are points of light, whatever the zoom. */
  universeLevel: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(size.w * dpr) || cv.height !== Math.round(size.h * dpr)) {
      cv.width = Math.round(size.w * dpr);
      cv.height = Math.round(size.h * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h } = size;
    const k = view.k;

    /* background */
    const bg = g.createLinearGradient(0, 0, w * 0.3, h);
    bg.addColorStop(0, SPACE.bg1);
    bg.addColorStop(1, SPACE.bg0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // ambient nebula clouds on a slow parallax layer
    const neb = [
      { x: 0.15, y: 0.2, r: 0.55, c: '#6d5de8', a: 0.1 },
      { x: 0.85, y: 0.75, r: 0.5, c: '#0e9f8e', a: 0.07 },
      { x: 0.6, y: 0.1, r: 0.35, c: '#3b4fd6', a: 0.06 },
    ];
    for (const n of neb) {
      const nx = n.x * w + view.x * 0.015;
      const ny = n.y * h + view.y * 0.015;
      const rr = n.r * Math.max(w, h);
      const gr = g.createRadialGradient(nx, ny, 0, nx, ny, rr);
      gr.addColorStop(0, rgba(n.c, n.a));
      gr.addColorStop(1, rgba(n.c, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }

    // star field, three parallax layers
    const { tile, layers: starLayers } = starField();
    const par = [0.02, 0.05, 0.1];
    starLayers.forEach((stars, li) => {
      const ox = (((view.x * par[li]) % tile) + tile) % tile;
      const oy = (((view.y * par[li]) % tile) + tile) % tile;
      for (let tx = -tile; tx < w + tile; tx += tile) {
        for (let ty = -tile; ty < h + tile; ty += tile) {
          const bx = tx + ox;
          const by = ty + oy;
          if (bx > w || by > h || bx + tile < 0 || by + tile < 0) continue;
          for (const s of stars) {
            const x = bx + s.x;
            const y = by + s.y;
            if (x < 0 || y < 0 || x > w || y > h) continue;
            g.globalAlpha = s.a;
            g.fillStyle = s.c;
            g.fillRect(x, y, s.s, s.s);
          }
        }
      }
    });
    g.globalAlpha = 1;

    const fade = galaxyFade(k);
    const toS = (wx: number, wy: number) => [wx * k + view.x, wy * k + view.y] as const;

    /* clusters: faint constellation lines between galaxies that belong together, and the cluster's name */
    if (universeLevel && clusters.length) drawClusters(g, clusters, galaxies, toS, k, galaxyBoxes);

    /* galaxies */
    for (const gx of galaxies) {
      const [cx, cy] = toS(gx.x, gx.y);
      const sr = gx.r * k;
      if (cx + sr * 1.6 < 0 || cy + sr * 1.6 < 0 || cx - sr * 1.6 > w || cy - sr * 1.6 > h) continue;
      const dimF = dim && !gx.matches ? 0.3 : 1;

      // halo glow
      const halo = g.createRadialGradient(cx, cy, 0, cx, cy, sr * 1.35);
      halo.addColorStop(0, rgba(gx.hex, (gx.virtual ? 0.05 : 0.16) * fade * dimF));
      halo.addColorStop(0.55, rgba(gx.hex, (gx.virtual ? 0.025 : 0.06) * fade * dimF));
      halo.addColorStop(1, rgba(gx.hex, 0));
      g.fillStyle = halo;
      g.beginPath();
      g.arc(cx, cy, sr * 1.35, 0, Math.PI * 2);
      g.fill();

      const parts = gx.virtual ? clusterParticles(gx.id) : spiralParticles(gx.id, gx.open);
      const sizeScale = clamp(sr / 140, 0.75, 1.9);
      g.globalCompositeOperation = 'lighter';
      const tones = [SPACE.white, gx.hex, SPACE.pale];
      for (let tone = 0; tone < 3; tone++) {
        g.fillStyle = tones[tone];
        for (let i = 0; i < parts.n; i++) {
          if (parts.tone[i] !== tone) continue;
          const px = cx + parts.x[i] * sr;
          const py = cy + parts.y[i] * sr;
          if (px < -4 || py < -4 || px > w + 4 || py > h + 4) continue;
          const sz = parts.size[i] * sizeScale;
          g.globalAlpha = parts.alpha[i] * fade * dimF * (gx.virtual ? 0.8 : 1);
          if (sz <= 1.8) g.fillRect(px - sz / 2, py - sz / 2, sz, sz);
          else {
            g.beginPath();
            g.arc(px, py, sz / 2, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      g.globalAlpha = 1;

      if (!gx.virtual) {
        // bright core
        const cr = sr * 0.2;
        const core = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
        core.addColorStop(0, rgba('#ffffff', 0.85 * fade * dimF));
        core.addColorStop(0.25, rgba(gx.hex, 0.55 * fade * dimF));
        core.addColorStop(1, rgba(gx.hex, 0));
        g.fillStyle = core;
        g.beginPath();
        g.arc(cx, cy, cr, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';

      if (dropTarget === gx.id) {
        // the galaxy a dragged star will join
        g.setLineDash([]);
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 2.5;
        g.shadowColor = gx.hex;
        g.shadowBlur = 18;
        g.beginPath();
        g.arc(cx, cy, sr, 0, Math.PI * 2);
        g.stroke();
        g.shadowBlur = 0;
      }

      if (gx.host && !gx.virtual) drawSurveyRing(g, cx, cy, sr, gx.hex, Math.max(fade, 0.45) * dimF);
      else if (isYours(hosted, gx)) drawOwnRim(g, cx, cy, sr, gx.hex, Math.max(fade, 0.45) * dimF);

      if (layers.beacons && gx.beacons.length) {
        const labels = universeLevel ? (sr >= 150 ? 'code' : 'none') : 'full';
        const many = labels !== 'none' && !!crowded?.has(gx.id);
        gx.beacons.forEach((b, i) => {
          const p = galaxyBeaconSpot(gx, i);
          const [bx, by] = toS(p.x, p.y);
          drawBeacon(g, b, bx, by, today, many ? 'none' : labels, dimF * (universeLevel ? 1 : Math.max(fade, 0.75)));
          if (many && i === 0) drawDatesCount(g, gx.beacons, bx, by, dimF);
        });
      }

      if (gx.virtual) {
        g.setLineDash([6, 8]);
        g.strokeStyle = rgba('#8E95A9', 0.35 * Math.max(fade, 0.4));
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(cx, cy, sr, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }

      /* systems inside this galaxy */
      for (const s of gx.systems) {
        const [sx, sy] = toS(s.x, s.y);
        const ext = s.extent * k;
        if (sx + ext < 0 || sy + ext < 0 || sx - ext > w || sy - ext > h) continue;
        const hex = colorHex(s.pv.project.color);
        const sDim = dim && !s.pv.matches && s.pv.project.id !== draggingId ? 0.3 : 1;

        if (k < LOD.systems || universeLevel) {
          if (s.portal) {
            // a portal from afar: a small violet ring
            const pr = clamp(s.pv.radius * k * 0.55, 2, 7);
            g.strokeStyle = rgba(PORTAL, 0.85 * sDim);
            g.lineWidth = 1.4;
            g.beginPath();
            g.arc(sx, sy, pr * 1.6, 0, Math.PI * 2);
            g.stroke();
            continue;
          }
          // a point of light, brighter with more open work
          const pr = clamp(s.pv.radius * k * 0.55, 1.6, 7);
          const glow = g.createRadialGradient(sx, sy, 0, sx, sy, pr * 4);
          glow.addColorStop(0, rgba('#ffffff', 0.95 * sDim));
          glow.addColorStop(0.25, rgba(hex, 0.8 * sDim));
          glow.addColorStop(1, rgba(hex, 0));
          g.fillStyle = glow;
          g.beginPath();
          g.arc(sx, sy, pr * 4, 0, Math.PI * 2);
          g.fill();
          if (s.pv.hasActive) {
            g.strokeStyle = rgba(SPACE.teal, 0.9);
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(sx, sy, pr * 2.6, 0, Math.PI * 2);
            g.stroke();
          }
          continue;
        }

        if (k >= LOD.planetDots) {
          // orbits
          const orbitA = clamp((k - LOD.planetDots) / 0.25, 0, 1);
          g.strokeStyle = rgba(hex, 0.28 * orbitA * sDim);
          g.lineWidth = 1;
          g.setLineDash([2, 5]);
          for (const r of s.rings) {
            g.beginPath();
            g.arc(sx, sy, r * k, 0, Math.PI * 2);
            g.stroke();
          }
          g.setLineDash([]);

          if (s.busy) drawBusyRing(g, s, sx, sy, k, hex, today, Math.max(orbitA, 0.7) * sDim, k >= LOD.planets, families);

          // planet dots while planets are too small to interact with
          if (k < LOD.planets) {
            s.pv.tasks.forEach((tv, i) => {
              const sl = s.slots[i];
              if (!sl) return;
              const px = sx + sl.x * k;
              const py = sy + sl.y * k;
              const t = tv.task;
              const overdue = t.status !== 'done' && t.due && daysBetween(today, t.due) < 0;
              g.fillStyle = tv.active ? SPACE.teal : overdue ? SPACE.danger : hex;
              g.globalAlpha = (t.status === 'done' ? 0.35 : 0.55 + t.priority * 0.11) * orbitA * sDim;
              g.beginPath();
              g.arc(px, py, Math.max(1.4, (sl.d / 2) * k), 0, Math.PI * 2);
              g.fill();
            });
            const nt = s.pv.tasks.length;
            (s.pv.items ?? []).forEach((iv, j) => {
              const sl = s.slots[nt + j];
              if (!sl) return;
              const col = famColor(families, iv.item.family);
              const r = Math.max(1.4, (sl.d / 2) * k);
              g.globalAlpha = (iv.item.ghost ? 0.35 : iv.item.state === 'live' ? 0.85 : 0.6) * orbitA * sDim;
              g.beginPath();
              g.arc(sx + sl.x * k, sy + sl.y * k, r, 0, Math.PI * 2);
              if (iv.item.state === 'live' && !iv.item.ghost) {
                g.fillStyle = col;
                g.fill();
              } else {
                g.strokeStyle = col;
                g.lineWidth = 1;
                g.stroke();
              }
            });
            g.globalAlpha = 1;
          }
        }

        /* what a host adds around a system: its belt, its beacons, and moons on its planets */
        if (s.belt && layers.belts && k >= LOD.planetDots) {
          const a = clamp((k - LOD.planetDots) / 0.25, 0.35, 1) * sDim;
          drawBelt(g, s, families, sx, sy, k, a, k >= LOD.planets);
        }
        if (s.beacons.length && layers.beacons && k >= LOD.systems) {
          const labels = k >= LOD.planets ? 'full' : 'code';
          const many = !!crowded?.has(s.pv.project.id);
          s.beacons.forEach((b, i) => {
            const p = systemBeaconSpot(s, i);
            const [bx, by] = toS(p.x, p.y);
            drawBeacon(g, b, bx, by, today, many ? 'none' : labels, sDim);
            if (many && i === 0) drawDatesCount(g, s.beacons, bx, by, sDim);
          });
        }
        if (layers.moons && k >= LOD.planets) {
          s.pv.tasks.forEach((tv, i) => {
            const sl = s.slots[i];
            if (!sl || !tv.moons) return;
            const d = clamp(sl.d * k, 14, 64);
            const lab = planetLabels?.get(tv.task.id);
            // the arc sits away from the planet's name; with no name shown, on the side facing the star
            const away = lab?.shown ? AWAY[lab.side] : Math.atan2(-sl.y, -sl.x);
            drawMoons(g, tv.moons, families, sx + sl.x * k, sy + sl.y * k, d, k, away, (dim && !tv.matches ? 0.3 : 1) * sDim);
          });
          const nt = s.pv.tasks.length;
          (s.pv.items ?? []).forEach((iv, j) => {
            const sl = s.slots[nt + j];
            if (!sl || s.busy || (!iv.item.moons.items.length && !iv.item.moons.more)) return;
            const d = clamp(sl.d * k, 14, 64);
            const lab = planetLabels?.get(iv.item.id);
            const away = lab?.shown ? AWAY[lab.side] : Math.atan2(-sl.y, -sl.x);
            drawMoons(g, iv.item.moons, families, sx + sl.x * k, sy + sl.y * k, d, k, away, (dim && !iv.matches ? 0.3 : 1) * sDim * (iv.item.ghost ? 0.5 : 1));
          });
        }
      }
    }

    /* dependency arrows between visible planets */
    if (showDeps && k >= LOD.planets) {
      const pos = new Map<string, { x: number; y: number; d: number }>();
      for (const gx of galaxies)
        for (const s of gx.systems)
          s.pv.tasks.forEach((tv, i) => {
            const sl = s.slots[i];
            if (sl) pos.set(tv.task.id, { x: (s.x + sl.x) * k + view.x, y: (s.y + sl.y) * k + view.y, d: sl.d * k });
          });
      g.lineWidth = 1.3;
      g.setLineDash([4, 4]);
      for (const gx of galaxies)
        for (const s of gx.systems)
          for (const tv of s.pv.tasks)
            for (const dep of tv.task.dependsOn) {
              const a = pos.get(dep);
              const b = pos.get(tv.task.id);
              if (!a || !b) continue;
              const ang = Math.atan2(b.y - a.y, b.x - a.x);
              const fx = a.x + Math.cos(ang) * (a.d / 2 + 6);
              const fy = a.y + Math.sin(ang) * (a.d / 2 + 6);
              const tx = b.x - Math.cos(ang) * (b.d / 2 + 9);
              const ty = b.y - Math.sin(ang) * (b.d / 2 + 9);
              const alpha = tv.task.status === 'done' ? 0.3 : 0.7;
              g.strokeStyle = rgba('#c3c8da', alpha);
              g.beginPath();
              g.moveTo(fx, fy);
              g.lineTo(tx, ty);
              g.stroke();
              g.setLineDash([]);
              g.fillStyle = rgba('#c3c8da', alpha);
              g.beginPath();
              g.moveTo(tx, ty);
              g.lineTo(tx - Math.cos(ang - 0.45) * 8, ty - Math.sin(ang - 0.45) * 8);
              g.lineTo(tx - Math.cos(ang + 0.45) * 8, ty - Math.sin(ang + 0.45) * 8);
              g.closePath();
              g.fill();
              g.setLineDash([4, 4]);
            }
      g.setLineDash([]);
    }

    /* a verse's relations between planets ("made from"): thin solid curves, never the dashes of dependencies */
    if (arrows.length && k >= LOD.planets) drawArrows(g, arrows, arrowFocus);

    // soft vignette
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }, [view, size, galaxies, dim, today, showDeps, universeLevel, dropTarget, draggingId, families, clusters, layers, planetLabels, crowded, arrows, arrowFocus]);

  return <canvas ref={ref} data-sky className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

/* ---------------- what a host adds ---------------- */

const FONT = 'Inter Variable, system-ui, sans-serif';
/** Portals (systems that lead to another verse), and the arrows of relations. */
export const PORTAL = '#b18cff';
const ARROW = '#8fd8ff';

/** Relations between planets: a thin curve with an open chevron at its end; its label when an end is in focus. */
function drawArrows(g: CanvasRenderingContext2D, arrows: ArrowCurve[], focus?: Set<string>) {
  g.save();
  g.setLineDash([]);
  for (const c of arrows) {
    const on = !!focus && (focus.has(c.from) || focus.has(c.to));
    g.strokeStyle = rgba(ARROW, on ? 0.95 : 0.5);
    g.lineWidth = on ? 1.8 : 1.2;
    g.beginPath();
    g.moveTo(c.ax, c.ay);
    g.quadraticCurveTo(c.cx, c.cy, c.bx, c.by);
    g.stroke();
    // an open chevron along the curve's end direction
    const a = Math.atan2(c.by - c.cy, c.bx - c.cx);
    g.beginPath();
    g.moveTo(c.bx - Math.cos(a - 0.5) * 8, c.by - Math.sin(a - 0.5) * 8);
    g.lineTo(c.bx, c.by);
    g.lineTo(c.bx - Math.cos(a + 0.5) * 8, c.by - Math.sin(a + 0.5) * 8);
    g.stroke();
  }
  g.restore();
  for (const c of arrows) {
    if (!c.label || !focus || !(focus.has(c.from) || focus.has(c.to))) continue;
    const m = curveMid(c);
    g.save();
    g.font = `600 11px ${FONT}`;
    const w = g.measureText(c.label).width + 12;
    g.fillStyle = 'rgba(8,12,24,0.9)';
    g.strokeStyle = rgba(ARROW, 0.6);
    g.lineWidth = 1;
    roundRect(g, m.x - w / 2, m.y - 9, w, 18, 9);
    g.fill();
    g.stroke();
    g.restore();
    text(g, c.label, m.x, m.y, { color: '#d6f1ff', size: 11, weight: 600, align: 'center' });
  }
}
const famColor = (families: Record<string, Family>, id: string) => families[id]?.color ?? '#c9d2ee';
const famLabel = (families: Record<string, Family>, id: string) => families[id]?.label ?? id;

function text(g: CanvasRenderingContext2D, t: string, x: number, y: number, o: { color: string; size?: number; weight?: number; align?: CanvasTextAlign; base?: CanvasTextBaseline; alpha?: number }) {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.font = `${o.weight ?? 500} ${o.size ?? 11}px ${FONT}`;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = o.base ?? 'middle';
  g.shadowColor = 'rgba(0,0,0,.95)';
  g.shadowBlur = 6;
  g.fillStyle = o.color;
  g.fillText(t, x, y);
  g.restore();
}

/** One of ORBIT's own galaxies beside a host's: a thin solid rim, quiet, readable at any zoom. */
function drawOwnRim(g: CanvasRenderingContext2D, cx: number, cy: number, sr: number, hex: string, alpha: number) {
  g.save();
  g.setLineDash([]);
  g.strokeStyle = rgba(hex, 0.55 * alpha);
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(cx, cy, sr * 1.04, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** A surveyed galaxy (a host's record): a dashed ring with ticks just outside its disk. */
function drawSurveyRing(g: CanvasRenderingContext2D, cx: number, cy: number, sr: number, hex: string, alpha: number) {
  const rr = sr * 1.04;
  g.save();
  g.strokeStyle = rgba(hex, 0.5 * alpha);
  g.lineWidth = 1.1;
  g.setLineDash([2, 6]);
  g.beginPath();
  g.arc(cx, cy, rr, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  const ticks = sr > 120 ? 48 : 24;
  for (let t = 0; t < ticks; t++) {
    const a = (t / ticks) * Math.PI * 2;
    const l = t % 4 === 0 ? Math.min(7, 2 + sr * 0.02) : Math.min(3, 1 + sr * 0.01);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    g.lineTo(cx + Math.cos(a) * (rr + l), cy + Math.sin(a) * (rr + l));
    g.stroke();
  }
  g.restore();
}

/**
 * Galaxies that belong together (a cluster): one faint outline around all of them and their names, with the
 * cluster's name on the outline at the top, so it reads as "these belong together" and not as one galaxy's label.
 */
function drawClusters(g: CanvasRenderingContext2D, clusters: Cluster[], galaxies: GalaxyPlace[], toS: (x: number, y: number) => readonly [number, number], k: number, boxes?: Map<string, { x: number; y: number; w: number; h: number }>) {
  // every galaxy's name and counts: a cluster's name goes where it covers none of them
  g.save();
  g.font = `600 15px ${FONT}`;
  const boxOf = (gx: GalaxyPlace) => {
    const known = boxes?.get(gx.id);
    if (known) return known;
    const [cx, cy] = toS(gx.x, gx.y);
    return universeLabelBox(cx, cy, gx.r * k, g.measureText(gx.name.toUpperCase()).width * 1.15 + 24);
  };
  const labelBoxes = galaxies.map(boxOf);
  g.restore();
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  for (const c of clusters) {
    const members = galaxies.filter((gx) => gx.host?.cluster === c.id);
    if (!members.length) continue;
    g.save();
    g.font = `600 15px ${FONT}`;
    const pts: [number, number][] = [];
    for (const m of members) {
      const [cx, cy] = toS(m.x, m.y);
      const sr = m.r * k;
      const lab = boxOf(m);
      pts.push(...clusterOutlinePoints(cx, cy, sr * 1.12 + 10, lab));
    }
    const hull = convexHull(pts);
    if (hull.length < 3) {
      g.restore();
      continue;
    }
    g.beginPath();
    hull.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = 'rgba(207,217,255,0.03)';
    g.fill();
    g.setLineDash([5, 6]);
    g.lineJoin = 'round';
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(207,217,255,0.32)';
    g.stroke();
    g.setLineDash([]);
    // the name, on the outline (at its top, else at its bottom), centred over the members, covering no
    // galaxy's name or counts and no other cluster's name
    const ys = hull.map((p) => p[1]);
    const xs = hull.map((p) => p[0]);
    const lx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const name = c.name.toUpperCase();
    g.font = `600 12px ${FONT}`;
    const tw = g.measureText(name).width * 1.12 + 22;
    // on the line, a little outside it: above the top, else below the bottom
    const spots = [Math.min(...ys) - 15, Math.max(...ys) - 7].map((y) => ({ x: lx - tw / 2, y, w: tw, h: 22 }));
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      [...labelBoxes, ...taken].some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);
    const spot = spots.find((r) => !hit(r)) ?? spots[0];
    taken.push(spot);
    g.fillStyle = 'rgba(10,12,22,0.92)';
    g.strokeStyle = 'rgba(207,217,255,0.4)';
    g.lineWidth = 1;
    roundRect(g, spot.x, spot.y, tw, 22, 11);
    g.fill();
    g.stroke();
    g.restore();
    text(g, name.split('').join('\u200A'), lx, spot.y + 11, { color: '#dfe6ff', size: 12, weight: 600, align: 'center', alpha: 0.92 });
  }
}

/** Where a galaxy's name, chip and counts sit at universe level (as Canvas's GalaxyLabel draws them). */
export function universeLabelBox(cx: number, cy: number, sr: number, nameW: number) {
  const top = cy + Math.min(sr * 0.92, sr * 0.5 + 70);
  const w = Math.max(190, nameW);
  return { x: cx - w / 2, y: top, w, h: 88 };
}

/** Points around a galaxy (a circle) and its label box, for the outline of a cluster. */
export function clusterOutlinePoints(cx: number, cy: number, r: number, box: { x: number; y: number; w: number; h: number }): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const p = 10;
  out.push([box.x - p, box.y - p], [box.x + box.w + p, box.y - p], [box.x - p, box.y + box.h + p], [box.x + box.w + p, box.y + box.h + p]);
  return out;
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const BEACON_COLOR: Record<Beacon['state'], string> = { planned: '#ffffff', soon: SPACE.amber, late: SPACE.danger, achieved: SPACE.teal, rescoped: '#8e95a9' };

function beaconWhen(b: Beacon, today: string): string {
  if (b.state === 'achieved') return 'achieved';
  if (b.state === 'rescoped') return 'rescoped';
  if (!b.due) return b.state;
  const d = daysBetween(today, b.due);
  return d < 0 ? `${-d} d late` : d === 0 ? 'today' : `in ${d} d`;
}

/** A date that matters: a diamond, coloured by state; with its code (and title) and the days left. */
function drawBeacon(g: CanvasRenderingContext2D, b: Beacon, x: number, y: number, today: string, label: 'none' | 'code' | 'full', alpha = 1) {
  const col = BEACON_COLOR[b.state];
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.rotate(Math.PI / 4);
  g.lineWidth = 1.6;
  g.strokeStyle = col;
  g.shadowColor = col;
  g.shadowBlur = b.state === 'rescoped' ? 0 : 10;
  if (b.state === 'rescoped') g.setLineDash([2, 2]);
  g.fillStyle = b.state === 'achieved' ? col : '#0a0c16';
  g.fillRect(-4.5, -4.5, 9, 9);
  g.strokeRect(-4.5, -4.5, 9, 9);
  g.restore();
  if (label === 'none') return;
  const when = beaconWhen(b, today);
  const serves = b.serves ? ` · serves ${b.serves}` : '';
  const name = label === 'full' ? [b.code, b.title].filter(Boolean).join(' ') : (b.code ?? b.title);
  text(g, `${name} · ${when}${label === 'full' ? serves : ''}`, x + 10, y, { color: col, size: 11, weight: 600, alpha: alpha * (b.state === 'rescoped' ? 0.8 : 1) });
}

/** The direction (radians, screen) away from a label on this side of its planet. */
const AWAY: Record<LabelSide, number> = { right: Math.PI, left: 0, above: Math.PI / 2, below: -Math.PI / 2 };

/** "5 dates" beside the first of a column of dates too close together to label one by one. */
function drawDatesCount(g: CanvasRenderingContext2D, beacons: Beacon[], x: number, y: number, alpha: number) {
  const urgent = beacons.find((b) => b.state === 'late') ?? beacons.find((b) => b.state === 'soon');
  text(g, `${beacons.length} dates`, x + 10, y, { color: urgent ? BEACON_COLOR[urgent.state] : '#ffffff', size: 11, weight: 600, alpha });
}

/** Moons on a planet: one dot per attachment, coloured by family; at most five, then "+n". */
function drawMoons(g: CanvasRenderingContext2D, set: MoonSet, families: Record<string, Family>, px: number, py: number, d: number, k: number, mid: number, alpha: number) {
  const shown = set.items.slice(0, CLUTTER.moons);
  const extra = set.items.length - shown.length + set.more;
  if (!shown.length && !extra) return;
  const orbit = d / 2 + 9;
  const mr = clamp(1.6 + k * 1.2, 2.2, 4);
  const step = (mr * 2 + 3.5) / orbit;
  // the arc is centred on `mid` (away from the planet's name)
  const start = mid - (step * (shown.length - 1)) / 2;
  g.save();
  g.globalAlpha = 0.3 * alpha;
  g.strokeStyle = '#c9d2ee';
  g.lineWidth = 0.8;
  g.setLineDash([1.5, 3]);
  g.beginPath();
  g.arc(px, py, orbit, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  shown.forEach((m, i) => {
    const a = start + i * step;
    const x = px + Math.cos(a) * orbit;
    const y = py + Math.sin(a) * orbit;
    const col = m.flag === 'changed' ? SPACE.danger : famColor(families, m.family);
    g.globalAlpha = alpha * (m.state === 'gone' ? 0.75 : 1);
    g.fillStyle = col;
    g.strokeStyle = col;
    g.shadowColor = col;
    g.shadowBlur = m.state === 'live' ? 6 : 0;
    g.beginPath();
    g.arc(x, y, mr, 0, Math.PI * 2);
    if (m.state === 'live') g.fill();
    else {
      g.fillStyle = '#0a0c16';
      g.fill();
      g.lineWidth = 1.3;
      g.stroke();
      if (m.state === 'gone') {
        g.beginPath();
        g.moveTo(x - mr - 1.5, y + mr + 1.5);
        g.lineTo(x + mr + 1.5, y - mr - 1.5);
        g.stroke();
      }
    }
    g.shadowBlur = 0;
  });
  g.restore();
  if (extra > 0) {
    // "+n": on a dark pill so it reads over stars, dust and orbits
    const a = start + shown.length * step + step * 0.55;
    const label = `+${extra}`;
    g.save();
    g.font = `700 12px ${FONT}`;
    const w = g.measureText(label).width + 10;
    g.restore();
    const cx = px + Math.cos(a) * (orbit + 4 + w / 2);
    const cy = py + Math.sin(a) * (orbit + 4 + 8);
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(8,10,20,0.88)';
    g.strokeStyle = 'rgba(201,210,238,0.55)';
    g.lineWidth = 1;
    roundRect(g, cx - w / 2, cy - 8.5, w, 17, 8.5);
    g.fill();
    g.stroke();
    g.restore();
    text(g, label, cx, cy + 0.5, { color: '#eef2ff', size: 12, weight: 700, align: 'center', alpha });
  }
}

/** A belt: one rock per item, coloured by family; when there are many, a ring of haze with a count. */
function drawBelt(g: CanvasRenderingContext2D, s: SystemPlace, families: Record<string, Family>, sx: number, sy: number, k: number, alpha: number, detail: boolean) {
  const belt = s.belt!;
  const R = belt.r * k;
  const r = rng(hashString(s.pv.project.id));
  g.save();
  if (!detail) {
    // from afar: a faint ring
    g.globalAlpha = 0.35 * alpha;
    g.strokeStyle = '#c9d2ee';
    g.lineWidth = Math.max(1, 6 * k);
    g.setLineDash([1, 3]);
    g.beginPath();
    g.arc(sx, sy, R, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    return;
  }
  // a soft band, then dust on it
  const band = (belt.haze ? 34 : 20) * k;
  g.globalAlpha = (belt.haze ? 0.16 : 0.09) * alpha;
  g.strokeStyle = '#c9d2ee';
  g.lineWidth = band;
  g.beginPath();
  g.arc(sx, sy, R, 0, Math.PI * 2);
  g.stroke();
  const dust = belt.haze ? 900 : 260;
  g.fillStyle = '#dfe6ff';
  for (let i = 0; i < dust; i++) {
    const a = r() * Math.PI * 2;
    const rr = R + (r() - 0.5) * band * 1.2;
    g.globalAlpha = (belt.haze ? 0.25 + r() * 0.35 : 0.14 + r() * 0.14) * alpha;
    const sz = r() < 0.15 ? 1.8 : 1.1;
    g.fillRect(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr, sz, sz);
  }
  const items = belt.collection.items ?? [];
  if (!belt.haze) {
    // one rock per item, big enough to see and in its family's colour, with a dark rim so it stands off the dust
    const size = clamp(5.6 * Math.sqrt(k), 4, 9.5);
    items.forEach((it, i) => {
      const a = (i / items.length) * Math.PI * 2 + 0.35 + r() * 0.15;
      const rr = R + (r() - 0.5) * 10 * k;
      const cx = sx + Math.cos(a) * rr;
      const cy = sy + Math.sin(a) * rr;
      const col = famColor(families, it.family);
      g.beginPath();
      for (let v = 0; v < 7; v++) {
        const va = (v / 7) * Math.PI * 2 + i;
        const vr = size * (0.78 + 0.4 * ((hashString(it.id + v) % 100) / 100));
        const X = cx + Math.cos(va) * vr;
        const Y = cy + Math.sin(va) * vr;
        if (v) g.lineTo(X, Y);
        else g.moveTo(X, Y);
      }
      g.closePath();
      g.globalAlpha = alpha;
      g.lineWidth = 1.6;
      g.strokeStyle = 'rgba(4,5,10,0.9)';
      g.stroke();
      g.shadowColor = col;
      g.shadowBlur = it.state === 'live' ? 8 : 0;
      g.fillStyle = it.state === 'live' ? col : '#0a0c16';
      g.globalAlpha = (it.state === 'live' ? 1 : 0.9) * alpha;
      g.fill();
      g.shadowBlur = 0;
      if (it.state !== 'live') {
        g.lineWidth = 1.4;
        g.strokeStyle = col;
        g.stroke();
      }
    });
  }
  g.restore();
  // what it is, in words: how many are held here that no task uses yet, then the families, each with its colour
  const counts = new Map<string, number>();
  if (belt.haze && belt.collection.counts) for (const [f, n] of Object.entries(belt.collection.counts)) counts.set(f, n);
  else for (const it of items) counts.set(it.family, (counts.get(it.family) ?? 0) + 1);
  const total = belt.collection.total;
  const y0 = sy + R + 14 * Math.max(1, k) + 4;
  text(g, `${total} item${total === 1 ? '' : 's'} held here that no task uses yet`, sx, y0, { color: '#c9d2ee', size: 11.5, weight: 600, align: 'center', alpha: 0.95 * alpha });
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([f, n]) => ({ f, t: `${famLabel(families, f)} ${n}` }));
  if (!parts.length) return;
  g.save();
  g.font = `500 11px ${FONT}`;
  const widths = parts.map((p) => g.measureText(p.t).width + 12);
  g.restore();
  const gapW = 12;
  let x = sx - (widths.reduce((a, b) => a + b, 0) + gapW * (parts.length - 1)) / 2;
  parts.forEach((p, i) => {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = famColor(families, p.f);
    g.beginPath();
    g.arc(x + 3.5, y0 + 16, 3.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
    text(g, p.t, x + 11, y0 + 16, { color: '#aab3cc', size: 11, alpha: 0.95 * alpha });
    x += widths[i] + gapW;
  });
}

/** A system with too many open tasks to draw: a ring of small dots, one per task, and the count. */
function drawBusyRing(g: CanvasRenderingContext2D, s: SystemPlace, sx: number, sy: number, k: number, hex: string, today: string, alpha: number, detail: boolean, families: Record<string, Family> = {}) {
  const R = s.rings[0] * k;
  if (s.busyItems) {
    // items: one dot each, in its family's colour; hollow when archived or gone
    const items = s.pv.items;
    const n = Math.max(items.length, 1);
    const dot = clamp(2.2 * Math.sqrt(k) * 1.4, 1.4, 3.4);
    g.save();
    items.forEach((iv, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const col = famColor(families, iv.item.family);
      g.globalAlpha = alpha * (iv.matches ? 0.9 : 0.3);
      g.beginPath();
      g.arc(sx + Math.cos(a) * R, sy + Math.sin(a) * R, dot, 0, Math.PI * 2);
      if (iv.item.state === 'live') {
        g.fillStyle = col;
        g.fill();
      } else {
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.stroke();
      }
    });
    g.restore();
    if (detail) text(g, `${s.pv.itemCount} items · too many to draw one by one · listed in its panel`, sx, sy + R + 18, { color: '#c9d2ee', size: 11.5, weight: 600, align: 'center', alpha });
    return;
  }
  const open = s.pv.tasks.filter((t) => t.task.status !== 'done');
  const n = Math.max(open.length, 1);
  const dot = clamp(2.2 * Math.sqrt(k) * 1.4, 1.4, 3.4);
  g.save();
  open.forEach((tv, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const t = tv.task;
    const overdue = !!t.due && daysBetween(today, t.due) < 0;
    g.globalAlpha = (0.5 + t.priority * 0.12) * alpha * (tv.matches ? 1 : 0.3);
    g.fillStyle = tv.active ? SPACE.teal : overdue ? SPACE.danger : hex;
    g.beginPath();
    g.arc(sx + Math.cos(a) * R, sy + Math.sin(a) * R, dot, 0, Math.PI * 2);
    g.fill();
  });
  g.restore();
  if (detail) text(g, `${s.pv.stats.open} open tasks · too many to draw one by one`, sx, sy + R + 18, { color: '#c9d2ee', size: 11.5, weight: 600, align: 'center', alpha });
}
