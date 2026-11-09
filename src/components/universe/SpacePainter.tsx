import { useLayoutEffect, useRef } from 'react';
import { clamp, daysBetween } from '../../lib/util';
import { colorHex } from '../../lib/colors';
import { clusterParticles, LOD, spiralParticles, starField, type GalaxyPlace, type Size, type View } from './space';

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
}: {
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
    const { tile, layers } = starField();
    const par = [0.02, 0.05, 0.1];
    layers.forEach((stars, li) => {
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
            g.globalAlpha = 1;
          }
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

    // soft vignette
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }, [view, size, galaxies, dim, today, showDeps, universeLevel, dropTarget, draggingId]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
