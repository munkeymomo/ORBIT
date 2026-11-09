import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, CircleHelp, Lock, Maximize, Minus, Orbit, Pause, Plus, Search, SlidersHorizontal, Sparkles, Check, CornerLeftUp, X } from 'lucide-react';
import { orbit, useOrbit } from '../../store/store';
import { colorHex, inkOn } from '../../lib/colors';
import { useHotkeys } from '../../lib/hooks';
import { clamp, daysBetween, describeDue, fmtMinutes, toDateKey } from '../../lib/util';
import { IconButton, Menu, cx } from '../ui/primitives';
import { ProjectGlyph, PRIORITY_META } from '../ui/visuals';
import { filterActive, useUniverseModel, type TaskView } from './model';
import {
  buildSpace,
  contextAt,
  DEEP_SPACE_ID,
  galaxyAt,
  settleInGalaxy,
  easeInOutCubic,
  fitGalaxy,
  fitSystem,
  fitUniverse,
  interpolateView,
  LOD,
  MAX_K,
  MIN_K,
  screenToWorld,
  type GalaxyPlace,
  type Size,
  type SystemPlace,
  type View,
} from './space';
import { SpacePainter } from './SpacePainter';

const VIEW_KEY = 'orbit-space-view';
type Target = { kind: 'universe' } | { kind: 'galaxy'; id: string } | { kind: 'system'; id: string };
type Drag =
  | { kind: 'system'; id: string; wx: number; wy: number; origin: string; target: string | null }
  | { kind: 'galaxy'; id: string; x: number; y: number }
  | null;

function loadView(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k) ? v : null;
  } catch {
    return null;
  }
}

const reducedMotion = () => document.documentElement.dataset.motion === 'reduce';

export function UniverseCanvas({ onNewSystem, onNewGalaxy }: { onNewSystem: (galaxyId: string | null) => void; onNewGalaxy: () => void }) {
  const model = useUniverseModel();
  const groups = useOrbit((s) => s.groups);
  const deepSpace = useOrbit((s) => s.prefs.deepSpace);
  const filter = useOrbit((s) => s.filter);
  const selection = useOrbit((s) => s.selection);
  const flight = useOrbit((s) => s.flight);
  const { select, updateProject, updateGroup, setDeepSpace, setFilter, toast } = useOrbit.getActions();

  const box = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0, top: 76 });
  const [view, setViewState] = useState<View | null>(() => loadView());
  const [drag, setDragState] = useState<Drag>(null);
  // Mirrors `drag` so window-level listeners and the auto-pan loop always see the latest value.
  const dragNow = useRef<Drag>(null);
  const setDrag = (d: Drag) => {
    dragNow.current = d;
    setDragState(d);
  };
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [legend, setLegend] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const locked = useRef<Target | null>(null);
  const anim = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  const dim = filterActive(filter);
  const spaceDrag = drag?.kind === 'system' ? { kind: 'system' as const, id: drag.id, wx: drag.wx, wy: drag.wy } : drag;
  const galaxies = useMemo(
    () => buildSpace(model, groups, deepSpace, dim, spaceDrag),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, groups, deepSpace, dim, drag?.kind, drag?.id, drag && 'wx' in drag ? drag.wx : drag?.x, drag && 'wy' in drag ? drag.wy : drag?.y],
  );
  const galaxiesRef = useRef(galaxies);
  galaxiesRef.current = galaxies;
  const today = toDateKey(Date.now());

  /* ---------- view state ---------- */

  const setView = useCallback((v: View) => {
    setViewState(v);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    }, 250);
  }, []);

  const stopAnim = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  };

  /** Any manual pan/zoom releases the "follow this target" lock. */
  const manual = (v: View) => {
    stopAnim();
    locked.current = null;
    setView(v);
  };

  const viewFor = useCallback((t: Target): View | null => {
    const gs = galaxiesRef.current;
    const sz = sizeRef.current;
    if (!sz.w) return null;
    if (t.kind === 'universe') return fitUniverse(gs, sz);
    if (t.kind === 'galaxy') {
      const g = gs.find((x) => x.id === t.id);
      return g ? fitGalaxy(g, sz) : null;
    }
    for (const g of gs) {
      const s = g.systems.find((x) => x.pv.project.id === t.id);
      if (s) return fitSystem(s, sz);
    }
    return null;
  }, []);

  const animateTo = useCallback(
    (target: View) => {
      stopAnim();
      const from = viewRef.current;
      if (!from || reducedMotion()) {
        setView(target);
        return;
      }
      const sz = sizeRef.current;
      const span = Math.abs(Math.log(target.k / from.k));
      const dur = clamp(380 + span * 140, 380, 820);
      const start = performance.now();
      const step = (now: number) => {
        const t = clamp((now - start) / dur, 0, 1);
        setViewState(interpolateView(from, target, easeInOutCubic(t), sz));
        if (t < 1) anim.current = requestAnimationFrame(step);
        else {
          anim.current = null;
          setView(target);
        }
      };
      anim.current = requestAnimationFrame(step);
    },
    [setView],
  );

  const flyTo = useCallback(
    (t: Target) => {
      const v = viewFor(t);
      if (!v) return;
      locked.current = t;
      setQuickAdd(null);
      animateTo(v);
    },
    [viewFor, animateTo],
  );

  /* ---------- sizing ---------- */

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const top = Math.round((chrome.current?.getBoundingClientRect().height ?? 60) + 14);
      setSize((s) => {
        const w = Math.round(el.clientWidth);
        const h = Math.round(el.clientHeight);
        return s.w === w && s.h === h && s.top === top ? s : { w, h, top };
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (chrome.current) ro.observe(chrome.current);
    measure();
    return () => ro.disconnect();
  }, []);

  // First view, and keeping a locked target framed when the panel opens/closes.
  useEffect(() => {
    if (!size.w) return;
    if (!viewRef.current) {
      const v = viewFor({ kind: 'universe' });
      if (v) setView(v);
      return;
    }
    if (locked.current && !anim.current) {
      const v = viewFor(locked.current);
      if (v) setView(v);
    }
  }, [size.w, size.h, size.top, viewFor, setView]);

  // Requests from elsewhere (search, panels).
  const lastFlight = useRef(0);
  useEffect(() => {
    if (!flight || flight.nonce === lastFlight.current || !size.w) return;
    lastFlight.current = flight.nonce;
    if (flight.kind === 'universe') flyTo({ kind: 'universe' });
    else if (flight.id) flyTo({ kind: flight.kind, id: flight.id } as Target);
  }, [flight, size.w, flyTo]);

  const zoomAt = useCallback(
    (factor: number, sx?: number, sy?: number, animate = false) => {
      const v = viewRef.current;
      if (!v) return;
      const k = clamp(v.k * factor, MIN_K, MAX_K);
      const cx = sx ?? sizeRef.current.w / 2;
      const cy = sy ?? sizeRef.current.h / 2;
      const next = { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
      locked.current = null;
      if (animate) animateTo(next);
      else manual(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animateTo],
  );

  /* ---------- context & navigation ---------- */

  const ctx = view && size.w ? contextAt(galaxies, view, size) : { galaxy: null, system: null };
  const level: 'universe' | 'galaxy' | 'system' = ctx.system ? 'system' : ctx.galaxy ? 'galaxy' : 'universe';
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const goUp = useCallback(() => {
    const c = ctxRef.current;
    if (c.system && c.galaxy) flyTo({ kind: 'galaxy', id: c.galaxy.id });
    else if (c.galaxy) flyTo({ kind: 'universe' });
  }, [flyTo]);

  const sibling = useCallback(
    (dir: 1 | -1) => {
      const c = ctxRef.current;
      const gs = galaxiesRef.current;
      if (c.system && c.galaxy) {
        const list = c.galaxy.systems;
        const i = list.findIndex((s) => s.pv.project.id === c.system!.pv.project.id);
        const next = list[(i + dir + list.length) % list.length];
        if (next) flyTo({ kind: 'system', id: next.pv.project.id });
      } else if (gs.length) {
        const i = c.galaxy ? gs.findIndex((g) => g.id === c.galaxy!.id) : dir === 1 ? -1 : 0;
        const next = gs[(i + dir + gs.length) % gs.length];
        flyTo({ kind: 'galaxy', id: next.id });
      }
    },
    [flyTo],
  );

  useHotkeys((e) => {
    const s = orbit();
    if (s.view !== 'universe' || s.captureOpen || s.searchOpen || s.park || s.resumeFor || s.confirmReq || s.helpOpen) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (s.selection) return; // the app closes the panel first
      if (ctxRef.current.galaxy) {
        e.preventDefault();
        goUp();
      }
    } else if (e.key === ']') {
      e.preventDefault();
      sibling(1);
    } else if (e.key === '[') {
      e.preventDefault();
      sibling(-1);
    } else if (e.key === '0') {
      e.preventDefault();
      flyTo({ kind: 'universe' });
    } else if (e.key === '+' || e.key === '=') {
      zoomAt(1.35, undefined, undefined, true);
    } else if (e.key === '-' || e.key === '_') {
      zoomAt(1 / 1.35, undefined, undefined, true);
    }
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = viewRef.current;
    if (!v || (e.target as HTMLElement).tagName === 'INPUT') return;
    const step = 90;
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = pan[e.key];
    if (d) {
      e.preventDefault();
      manual({ ...v, x: v.x + d[0], y: v.y + d[1] });
    }
  };

  /* ---------- wheel ---------- */

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-ui]')) return;
      e.preventDefault();
      const v = viewRef.current;
      if (!v) return;
      const rect = el.getBoundingClientRect();
      const mouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseWheel) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - rect.left, e.clientY - rect.top);
      else manual({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAt]);

  /* ---------- background pan, pinch, click ---------- */

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: 'pan' | 'pinch'; sx: number; sy: number; v: View; dist?: number; mx?: number; my?: number; moved: boolean } | null>(null);

  const onBgDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || !view) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopAnim();
    if (pointers.current.size === 1) gesture.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, v: viewRef.current!, moved: false };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = box.current!.getBoundingClientRect();
      gesture.current = { mode: 'pinch', sx: 0, sy: 0, v: viewRef.current!, dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top, moved: true };
    }
  };
  const onBgMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'pan') {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      g.moved = true;
      manual({ ...g.v, x: g.v.x + dx, y: g.v.y + dy });
    } else if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = box.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      const k = clamp(g.v.k * (d / (g.dist || d)), MIN_K, MAX_K);
      const wx = (g.mx! - g.v.x) / g.v.k;
      const wy = (g.my! - g.v.y) / g.v.k;
      manual({ k, x: mx - wx * k, y: my - wy * k });
    }
  };
  const onBgUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      if (g?.mode === 'pan' && !g.moved) onBgClick(e);
      gesture.current = null;
    } else if (pointers.current.size === 1 && g?.mode === 'pinch') {
      const [p] = [...pointers.current.values()];
      gesture.current = { mode: 'pan', sx: p.x, sy: p.y, v: viewRef.current!, moved: true };
    }
  };

  /** Clicking open space: dive into the galaxy or system you clicked, otherwise clear the selection. */
  const onBgClick = (e: React.PointerEvent) => {
    const v = viewRef.current;
    if (!v || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const p = screenToWorld(v, e.clientX - rect.left, e.clientY - rect.top);
    setQuickAdd(null);
    if (!ctxRef.current.galaxy || v.k < LOD.systems * 1.15) {
      const g = galaxiesRef.current.find((x) => Math.hypot(x.x - p.x, x.y - p.y) < x.r);
      if (g) return flyTo({ kind: 'galaxy', id: g.id });
    } else if (v.k < LOD.planets) {
      for (const g of galaxiesRef.current) {
        const s = g.systems.find((x) => Math.hypot(x.x - p.x, x.y - p.y) < x.extent * 0.8);
        if (s) return flyTo({ kind: 'system', id: s.pv.project.id });
      }
    }
    select(null);
  };
  const onBgDouble = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    zoomAt(2.2, e.clientX - rect.left, e.clientY - rect.top, true);
  };

  /* ---------- dragging stars and galaxies ---------- */

  const dragRef = useRef<{
    kind: 'system' | 'galaxy';
    id: string;
    origin: string;
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    grabX: number;
    grabY: number;
    moved: boolean;
  } | null>(null);
  const dragLoop = useRef<number | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);

  const pointerWorld = (v: View, cx: number, cy: number) => {
    const rect = box.current!.getBoundingClientRect();
    return screenToWorld(v, cx - rect.left, cy - rect.top);
  };

  /** Where the dragged thing is now, from the pointer and the current view (so auto-pan keeps it under the cursor). */
  const placeDrag = (v: View) => {
    const d = dragRef.current;
    if (!d) return;
    const p = pointerWorld(v, d.cx, d.cy);
    const x = Math.round(p.x - d.grabX);
    const y = Math.round(p.y - d.grabY);
    if (d.kind === 'galaxy') {
      setDrag({ kind: 'galaxy', id: d.id, x, y });
      return;
    }
    const others = galaxiesRef.current;
    const over = galaxyAt(others, x, y);
    setDrag({ kind: 'system', id: d.id, wx: x, wy: y, origin: d.origin, target: over?.id ?? null });
  };

  const tickDrag = () => {
    const d = dragRef.current;
    const v = viewRef.current;
    if (!d || !v || !box.current) {
      dragLoop.current = null;
      return;
    }
    const rect = box.current.getBoundingClientRect();
    const edge = 56;
    const push = (dist: number) => (dist < edge ? ((Math.min(edge, edge - dist)) / edge) * 18 : 0);
    // The toolbar overlays the top of the canvas, so the top edge zone starts below it.
    const dx = push(d.cx - rect.left) - push(rect.right - d.cx);
    const dy = push(d.cy - rect.top - (sizeRef.current.top ?? 0)) - push(rect.bottom - d.cy);
    if (dx || dy) {
      const nv = { ...v, x: v.x + dx, y: v.y + dy };
      manual(nv);
      placeDrag(nv);
    }
    dragLoop.current = requestAnimationFrame(tickDrag);
  };

  const startDrag = (e: React.PointerEvent, kind: 'system' | 'galaxy', id: string, wx: number, wy: number, origin = '') => {
    if (e.button !== 0 || !viewRef.current) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pointerWorld(viewRef.current, e.clientX, e.clientY);
    dragRef.current = { kind, id, origin, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, grabX: p.x - wx, grabY: p.y - wy, moved: false };
    // Window listeners keep the drag alive even if the element under the pointer re-mounts
    // (e.g. the view changes level mid-drag and a star handle becomes a star node).
    const onMove = (ev: PointerEvent) => moveDrag(ev);
    const onUp = () => {
      cleanup();
      endDrag();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cleanup();
      cancelDrag();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
      dragCleanup.current = null;
    };
    dragCleanup.current?.();
    dragCleanup.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
  };
  const cancelDrag = () => {
    // The button is still held: the click that follows its release must not fly anywhere.
    suppressClick.current = true;
    const release = () => setTimeout(() => (suppressClick.current = false), 60);
    window.addEventListener('pointerup', release, { once: true });
    dragRef.current = null;
    if (dragLoop.current) cancelAnimationFrame(dragLoop.current);
    dragLoop.current = null;
    setDrag(null);
  };
  const moveDrag = (e: { clientX: number; clientY: number }) => {
    const d = dragRef.current;
    const v = viewRef.current;
    if (!d || !v) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    if (!d.moved) {
      stopAnim();
      locked.current = null;
      setQuickAdd(null);
      if (!dragLoop.current) dragLoop.current = requestAnimationFrame(tickDrag);
    }
    d.moved = true;
    placeDrag(v);
  };
  const endDrag = () => {
    const d = dragRef.current;
    const drag = dragNow.current;
    if (!d) return;
    dragRef.current = null;
    if (dragLoop.current) cancelAnimationFrame(dragLoop.current);
    dragLoop.current = null;
    if (d.moved && drag) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 60);
      if (drag.kind === 'galaxy') {
        if (drag.id === DEEP_SPACE_ID) setDeepSpace({ x: drag.x, y: drag.y });
        else updateGroup(drag.id, { x: drag.x, y: drag.y });
      } else {
        const gs = galaxiesRef.current;
        const origin = gs.find((g) => g.id === drag.origin);
        const target = drag.target ? gs.find((g) => g.id === drag.target) : null;
        const project = orbit().projects.find((p) => p.id === drag.id);
        if (target && target.id !== drag.origin && project) {
          const before = { groupId: project.groupId, x: project.x, y: project.y };
          const at = settleInGalaxy(target, drag.wx, drag.wy, drag.id);
          updateProject(drag.id, { groupId: target.virtual ? null : target.id, x: at.x, y: at.y });
          toast({
            tone: 'success',
            text: `Moved “${project.name}” to ${target.virtual ? 'deep space' : target.name}.`,
            action: { label: 'Undo', run: () => updateProject(drag.id, before) },
          });
        } else if (origin && (target?.id === origin.id || Math.hypot(drag.wx - origin.x, drag.wy - origin.y) < origin.r + 400)) {
          updateProject(drag.id, { x: drag.wx - origin.x, y: drag.wy - origin.y });
        } else {
          toast({ text: 'Drop a star onto another galaxy (or deep space) to move it there.' });
        }
      }
    }
    setDrag(null);
  };
  useEffect(
    () => () => {
      if (dragLoop.current) cancelAnimationFrame(dragLoop.current);
      dragCleanup.current?.();
    },
    [],
  );

  const onStarClick = (s: SystemPlace) => {
    if (suppressClick.current) return;
    if (ctx.system?.pv.project.id === s.pv.project.id) {
      const open = selection?.type === 'project' && selection.id === s.pv.project.id;
      select(open ? null : { type: 'project', id: s.pv.project.id });
    } else flyTo({ kind: 'system', id: s.pv.project.id });
  };
  const onGalaxyClick = (g: GalaxyPlace) => {
    if (suppressClick.current) return;
    if (ctx.galaxy?.id === g.id && !ctx.system && !g.virtual) select({ type: 'group', id: g.id });
    else flyTo({ kind: 'galaxy', id: g.id });
  };
  const onPlanetClick = (s: SystemPlace, taskId: string) => {
    select({ type: 'task', id: taskId });
    if (ctx.system?.pv.project.id !== s.pv.project.id) flyTo({ kind: 'system', id: s.pv.project.id });
  };

  /* ---------- render ---------- */

  const k = view?.k ?? 1;
  const toS = (wx: number, wy: number) => [wx * k + (view?.x ?? 0), wy * k + (view?.y ?? 0)] as const;
  const onScreen = (sx: number, sy: number, r: number) => sx + r > -40 && sy + r > -40 && sx - r < size.w + 40 && sy - r < size.h + 40;
  const query = filter.query.trim();

  return (
    <div data-theme="dark" className="absolute inset-0 text-text">
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-label={`Universe map, ${level} level. Click a galaxy or star to fly in; Escape goes up a level; square brackets jump to the previous or next; 0 shows everything; arrow keys pan.`}
        onKeyDown={onKeyDown}
        onPointerDown={onBgDown}
        onPointerMove={onBgMove}
        onPointerUp={onBgUp}
        onPointerCancel={onBgUp}
        onDoubleClick={onBgDouble}
        className="absolute inset-0 touch-none overflow-hidden outline-none select-none"
        style={{ cursor: 'grab' }}
      >
        {view && <SpacePainter view={view} size={size} galaxies={galaxies} dim={dim} today={today} showDeps={k >= LOD.planets} universeLevel={level === 'universe'} dropTarget={drag?.kind === 'system' && drag.target && drag.target !== drag.origin ? drag.target : null} draggingId={drag?.kind === 'system' ? drag.id : null} />}

        {view &&
          galaxies.map((g) => {
            const [cx, cy] = toS(g.x, g.y);
            const sr = g.r * k;
            if (!onScreen(cx, cy, sr * 1.2) || k > 1.05) return null;
            const universe = level === 'universe';
            return (
              <GalaxyLabel
                key={g.id}
                g={g}
                x={cx}
                y={universe ? cy + Math.min(sr * 0.92, sr * 0.5 + 70) : cy - sr - 6}
                compact={!universe}
                dimmed={dim && !g.matches}
                inside={ctx.galaxy?.id === g.id}
                dragging={drag?.kind === 'galaxy' && drag.id === g.id}
                onPointerDown={(e) => startDrag(e, 'galaxy', g.id, g.x, g.y)}
                dropTarget={drag?.kind === 'system' && drag.target === g.id && drag.origin !== g.id}
                onClick={() => onGalaxyClick(g)}
              />
            );
          })}

        {view &&
          k >= LOD.systems &&
          level !== 'universe' &&
          galaxies.flatMap((g) =>
            g.systems.map((s) => {
              const [sx, sy] = toS(s.x, s.y);
              if (!onScreen(sx, sy, s.extent * k)) return null;
              return (
                <StarNode
                  key={s.pv.project.id}
                  s={s}
                  x={sx}
                  y={sy}
                  k={k}
                  selected={selection?.type === 'project' && selection.id === s.pv.project.id}
                  current={ctx.system?.pv.project.id === s.pv.project.id}
                  dimmed={dim && !s.pv.matches}
                  dragging={drag?.kind === 'system' && drag.id === s.pv.project.id}
                  onPointerDown={(e) => startDrag(e, 'system', s.pv.project.id, s.x, s.y, g.id)}
                  onClick={() => onStarClick(s)}
                />
              );
            }),
          )}

        {view &&
          (level === 'universe' || k < LOD.systems) &&
          galaxies.flatMap((g) =>
            g.systems.map((s) => {
              const [sx, sy] = toS(s.x, s.y);
              if (!onScreen(sx, sy, 20)) return null;
              const name = s.pv.project.name;
              return (
                <button
                  key={`h-${s.pv.project.id}`}
                  aria-label={`${name} in ${g.name}. Click to fly to this system; drag onto another galaxy to move it.`}
                  title={`${name} — click to fly in, drag onto another galaxy to move it`}
                  onPointerDown={(e) => startDrag(e, 'system', s.pv.project.id, s.x, s.y, g.id)}
                  onClick={() => !suppressClick.current && flyTo({ kind: 'system', id: s.pv.project.id })}
                  className="absolute z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full outline-none hover:ring-2 hover:ring-white/50 focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ left: sx, top: sy }}
                />
              );
            }),
          )}

        {view &&
          drag?.kind === 'system' &&
          (() => {
            const [sx, sy] = toS(drag.wx, drag.wy);
            const target = drag.target ? galaxies.find((g) => g.id === drag.target) : null;
            const moving = target && target.id !== drag.origin;
            const origin = galaxies.find((g) => g.id === drag.origin);
            const outside = !target && origin && Math.hypot(drag.wx - origin.x, drag.wy - origin.y) >= origin.r + 400;
            if (!moving && !outside) return null;
            return (
              <div className="pointer-events-none absolute z-40 -translate-x-1/2 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap shadow-panel" style={{ left: sx, top: sy - 44, background: moving ? 'var(--accent)' : 'var(--surface-3)', borderColor: moving ? 'transparent' : 'var(--line-strong)', color: moving ? '#fff' : 'var(--muted)' }}>
                {moving ? `Move to ${target!.virtual ? 'deep space' : target!.name}` : 'Release to put it back'}
              </div>
            );
          })()}

        {view &&
          k >= LOD.planets &&
          level !== 'universe' &&
          galaxies.flatMap((g) =>
            g.systems.flatMap((s) => {
              const [sx, sy] = toS(s.x, s.y);
              if (!onScreen(sx, sy, s.extent * k)) return [];
              const nodes = s.pv.tasks.map((tv, i) => {
                const sl = s.slots[i];
                if (!sl) return null;
                return (
                  <PlanetNode
                    key={tv.task.id}
                    tv={tv}
                    color={colorHex(s.pv.project.color)}
                    x={sx + sl.x * k}
                    y={sy + sl.y * k}
                    d={clamp(sl.d * k, 14, 64)}
                    lightAngle={Math.atan2(-sl.y, -sl.x)}
                    today={today}
                    showLabel={k >= LOD.planetLabels}
                    labelAbove={sl.y < -10}
                    selected={selection?.type === 'task' && selection.id === tv.task.id}
                    dimmed={dim && (!s.pv.matches || (!!query && !tv.matches))}
                    onClick={() => onPlanetClick(s, tv.task.id)}
                  />
                );
              });
              const add = s.slots[s.slots.length - 1];
              nodes.push(
                <QuickAddSlot
                  key={`add-${s.pv.project.id}`}
                  projectId={s.pv.project.id}
                  color={colorHex(s.pv.project.color)}
                  x={sx + add.x * k}
                  y={sy + add.y * k}
                  active={quickAdd === s.pv.project.id}
                  onOpen={() => setQuickAdd(s.pv.project.id)}
                  onClose={() => setQuickAdd(null)}
                />,
              );
              return nodes;
            }),
          )}

        {galaxies.length === 0 && view && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">The universe is empty.</div>
        )}
      </div>

      {/* ---------- chrome ---------- */}
      <div ref={chrome} data-ui className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start gap-2 p-3 md:p-4">
        <Breadcrumbs ctx={ctx} galaxies={galaxies} onFly={flyTo} onUp={goUp} />
        <div className="flex-1" />
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <div className="flex h-10 w-40 items-center gap-2 rounded-xl border border-line bg-surface/80 px-3 shadow-panel backdrop-blur-xl focus-within:border-accent xl:w-56">
            <Search size={16} className="shrink-0 text-faint" />
            <input
              value={filter.query}
              onChange={(e) => setFilter({ query: e.target.value })}
              onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setFilter({ query: '' }))}
              placeholder="Highlight…"
              aria-label="Highlight matching systems and tasks"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            {filter.query && (
              <button onClick={() => setFilter({ query: '' })} aria-label="Clear" className="text-faint hover:text-text">
                <X size={15} />
              </button>
            )}
          </div>
          <FiltersButton />
          <div className="relative">
            <IconButton label="What the shapes mean" variant="secondary" active={legend} onClick={() => setLegend((l) => !l)} className="bg-surface/80 backdrop-blur-xl">
              <CircleHelp size={18} />
            </IconButton>
            {legend && <Legend onClose={() => setLegend(false)} />}
          </div>
          <Menu
            label="Create"
            trigger={(p) => (
              <button {...p} aria-label="New system or galaxy" title="New system or galaxy" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-medium text-white shadow-[0_6px_20px_-8px_var(--accent)] hover:brightness-110">
                <Plus size={16} /> <span className="hidden xl:inline">New</span> <ChevronDown size={14} />
              </button>
            )}
            items={[
              {
                label: ctx.galaxy && !ctx.galaxy.virtual ? `New system in ${ctx.galaxy.name}` : 'New system',
                icon: <Sparkles size={15} />,
                onSelect: () => onNewSystem(ctx.galaxy ? (ctx.galaxy.virtual ? null : ctx.galaxy.id) : null),
              },
              { label: 'New galaxy', icon: <Plus size={15} />, onSelect: onNewGalaxy },
              'sep',
              { label: 'Tidy galaxies into a spiral', icon: <Orbit size={15} />, onSelect: () => useOrbit.getActions().arrangeGalaxiesSpiral(), disabled: galaxies.length < 2 },
            ]}
          />
        </div>
      </div>

      {view && galaxies.length > 0 && <Minimap galaxies={galaxies} view={view} size={size} onFly={flyTo} onPan={(v) => { locked.current = null; animateTo(v); }} />}

      <div data-ui className="absolute right-3 bottom-3 flex items-center gap-1 rounded-xl border border-line bg-surface/80 p-1 shadow-panel backdrop-blur-xl md:right-4 md:bottom-4">
        <IconButton label="Zoom out (−)" size="sm" onClick={() => zoomAt(1 / 1.4, undefined, undefined, true)}>
          <Minus size={16} />
        </IconButton>
        <span className="tabular w-12 text-center text-xs font-medium text-muted" aria-live="off">
          {Math.round(k * 100)}%
        </span>
        <IconButton label="Zoom in (+)" size="sm" onClick={() => zoomAt(1.4, undefined, undefined, true)}>
          <Plus size={16} />
        </IconButton>
        <div className="mx-0.5 h-5 w-px bg-line" />
        <IconButton label="Whole universe (0)" size="sm" onClick={() => flyTo({ kind: 'universe' })}>
          <Maximize size={15} />
        </IconButton>
      </div>
    </div>
  );
}

/* ================= pieces ================= */

function Breadcrumbs({ ctx, galaxies, onFly, onUp }: { ctx: { galaxy: GalaxyPlace | null; system: SystemPlace | null }; galaxies: GalaxyPlace[]; onFly: (t: Target) => void; onUp: () => void }) {
  const crumb = 'inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-3';
  const galaxyItems = galaxies.map((g) => ({
    label: `${g.name}${g.virtual ? '' : ` · ${g.systems.length}`}`,
    icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.hex }} />,
    onSelect: () => onFly({ kind: 'galaxy', id: g.id }),
  }));
  return (
    <nav aria-label="Where you are in the universe" className="pointer-events-auto flex min-w-0 items-center gap-0.5 rounded-xl border border-line bg-surface/80 p-1 shadow-panel backdrop-blur-xl">
      <IconButton label="Up a level (Esc)" size="sm" onClick={onUp} disabled={!ctx.galaxy}>
        <CornerLeftUp size={16} />
      </IconButton>
      <button className={cx(crumb, !ctx.galaxy ? 'text-text' : 'text-muted')} onClick={() => onFly({ kind: 'universe' })} aria-current={!ctx.galaxy ? 'location' : undefined}>
        <Sparkles size={14} className="text-accent-ink" /> Universe
      </button>
      {ctx.galaxy ? (
        <>
          <ChevronRight size={14} className="shrink-0 text-faint" />
          <button className={cx(crumb, !ctx.system ? 'text-text' : 'text-muted')} onClick={() => onFly({ kind: 'galaxy', id: ctx.galaxy!.id })} aria-current={!ctx.system ? 'location' : undefined}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ctx.galaxy.hex }} />
            <span className="truncate">{ctx.galaxy.name}</span>
          </button>
          <Menu label="Jump to galaxy" align="left" trigger={(p) => <IconButton {...p} label="Jump to another galaxy" size="xs"><ChevronDown size={14} /></IconButton>} items={galaxyItems} />
          {ctx.system ? (
            <>
              <ChevronRight size={14} className="shrink-0 text-faint" />
              <span className={cx(crumb, 'text-text hover:bg-transparent')} aria-current="location">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorHex(ctx.system.pv.project.color) }} />
                <span className="truncate">{ctx.system.pv.project.name}</span>
              </span>
            </>
          ) : null}
          {ctx.galaxy.systems.length > 0 && (
            <Menu
              label="Jump to system"
              align="left"
              trigger={(p) =>
                ctx.system ? (
                  <IconButton {...p} label="Jump to another system" size="xs">
                    <ChevronDown size={14} />
                  </IconButton>
                ) : (
                  <button {...p} className={cx(crumb, 'text-muted')}>
                    <ChevronRight size={14} className="text-faint" /> Systems <ChevronDown size={13} />
                  </button>
                )
              }
              items={ctx.galaxy.systems.map((s) => ({
                label: s.pv.project.name,
                icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorHex(s.pv.project.color) }} />,
                onSelect: () => onFly({ kind: 'system', id: s.pv.project.id }),
              }))}
            />
          )}
        </>
      ) : (
        galaxies.length > 0 && (
          <Menu
            label="Jump to galaxy"
            align="left"
            trigger={(p) => (
              <button {...p} className={cx(crumb, 'text-muted')}>
                <ChevronRight size={14} className="text-faint" /> Galaxies <ChevronDown size={13} />
              </button>
            )}
            items={galaxyItems}
          />
        )
      )}
    </nav>
  );
}

function GalaxyLabel({
  g,
  x,
  y,
  compact,
  dimmed,
  inside,
  dragging,
  dropTarget,
  onPointerDown,
  onClick,
}: {
  g: GalaxyPlace;
  dropTarget?: boolean;
  x: number;
  y: number;
  compact: boolean;
  dimmed: boolean;
  inside: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
  const label = `${g.name} galaxy: ${g.systems.length} systems, ${g.open} open tasks, ${pct}% of tasks done.${g.overdue ? ` ${g.overdue} overdue.` : ''}${inside && !g.virtual ? ' Open details.' : ' Fly in.'}`;
  return (
    <button
      aria-label={label}
      title={g.virtual ? 'Projects without a galaxy — drag to move' : `${g.name} — click to ${inside ? 'see details' : 'fly in'}, drag to move`}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={cx(
        'absolute z-10 -translate-x-1/2 rounded-2xl text-center transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-accent',
        compact ? '-translate-y-full px-3 py-1' : 'px-4 py-2 hover:bg-white/5',
        dragging ? 'cursor-grabbing' : 'cursor-pointer',
        dropTarget && 'bg-white/10 ring-2 ring-white/60',
      )}
      style={{ left: x, top: y, opacity: dimmed ? 0.35 : 1 }}
    >
      <span className={cx('block font-display font-semibold tracking-[0.14em] uppercase [text-shadow:0_1px_12px_rgba(0,0,0,.9)]', compact ? 'text-[11px]' : 'text-[15px]')} style={{ color: g.virtual ? '#b8bdcc' : g.hex }}>
        {g.name}
      </span>
      {!compact && (
        <>
          <span className="tabular mt-0.5 block text-[12px] whitespace-nowrap text-muted [text-shadow:0_1px_8px_rgba(0,0,0,.9)]">
            {g.systems.length === 0 ? 'Empty — add a system' : `${g.systems.length} system${g.systems.length === 1 ? '' : 's'} · ${g.open} open · ${pct}%`}
            {g.overdue > 0 && <span className="text-danger"> · {g.overdue} overdue</span>}
          </span>
          {g.total > 0 && (
            <span className="mx-auto mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: g.hex }} />
            </span>
          )}
        </>
      )}
    </button>
  );
}

function StarNode({
  s,
  x,
  y,
  k,
  selected,
  current,
  dimmed,
  dragging,
  onPointerDown,
  onClick,
}: {
  s: SystemPlace;
  x: number;
  y: number;
  k: number;
  selected: boolean;
  current: boolean;
  dimmed: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const { project, stats } = s.pv;
  const hex = colorHex(project.color);
  const rs = clamp(s.pv.radius * k, 9, 66);
  const ring = rs + 6;
  const C = 2 * Math.PI * ring;
  const pct = Math.round(stats.progress * 100);
  const showMeta = rs >= 15 || k >= 0.5;
  const label = `${project.name}. ${stats.open} open, ${stats.parked} parked, ${stats.done} done, ${pct}% complete.${stats.overdue ? ` ${stats.overdue} overdue.` : ''} ${current ? 'Open details.' : 'Fly to this system.'}`;
  const box = ring * 2 + 8;
  return (
    <div className="absolute" style={{ left: x, top: y, width: 0, height: 0, opacity: dimmed ? 0.3 : 1, zIndex: dragging ? 30 : selected ? 22 : 18 }}>
      {/* corona */}
      <span
        className="pointer-events-none absolute rounded-full"
        style={{ left: -rs * 2.6, top: -rs * 2.6, width: rs * 5.2, height: rs * 5.2, background: `radial-gradient(circle, ${hex}55 0%, ${hex}1f 32%, transparent 68%)` }}
        aria-hidden
      />
      <button
        aria-label={label}
        title={`${project.name} — ${current ? 'click for details' : 'click to fly in'}, drag to move`}
        onPointerDown={onPointerDown}
        onClick={onClick}
        className={cx('group absolute rounded-full outline-none', dragging ? 'cursor-grabbing' : 'cursor-pointer')}
        style={{ left: -box / 2, top: -box / 2, width: box, height: box }}
      >
        <svg className="absolute inset-0 -rotate-90 overflow-visible" width={box} height={box} aria-hidden>
          <circle cx={box / 2} cy={box / 2} r={ring} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={Math.max(2, rs * 0.09)} />
          <circle
            cx={box / 2}
            cy={box / 2}
            r={ring}
            fill="none"
            stroke={hex}
            strokeWidth={Math.max(2, rs * 0.09)}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - stats.progress)}
            style={{ transition: 'stroke-dashoffset .6s ease' }}
          />
        </svg>
        <span
          className={cx('absolute flex items-center justify-center rounded-full transition-transform duration-200 group-focus-visible:ring-4 group-focus-visible:ring-accent/60', !dragging && 'group-hover:scale-[1.06]')}
          style={{
            left: box / 2 - rs,
            top: box / 2 - rs,
            width: rs * 2,
            height: rs * 2,
            background: `radial-gradient(circle at 40% 36%, #ffffff 0%, color-mix(in srgb, ${hex} 45%, white) 22%, ${hex} 58%, color-mix(in srgb, ${hex} 70%, black) 100%)`,
            boxShadow: [`0 0 ${rs * 0.9}px ${rs * 0.18}px ${hex}aa`, selected ? `0 0 0 3px #0a0c12, 0 0 0 5px ${hex}` : '', s.pv.hasActive ? '0 0 0 3px #2dd4bf, 0 0 26px 4px rgba(45,212,191,.6)' : '']
              .filter(Boolean)
              .join(', '),
            color: inkOn(hex),
          }}
        >
          {rs >= 20 && <ProjectGlyph icon={project.icon} size={Math.round(rs * 0.62)} className="opacity-80" />}
        </span>
        {rs >= 15 && stats.overdue > 0 && (
          <span className="absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white ring-2 ring-[#0a0c12]" style={{ right: 0, top: 0 }} title={`${stats.overdue} overdue`}>
            {stats.overdue}
          </span>
        )}
        {rs >= 15 && stats.parked > 0 && (
          <span className="absolute flex h-5 items-center gap-0.5 rounded-full bg-[#F5B544] px-1.5 text-[10.5px] font-bold text-[#2a1a00] ring-2 ring-[#0a0c12]" style={{ left: 0, top: 0 }} title={`${stats.parked} parked`}>
            <Pause size={9} strokeWidth={3} />
            {stats.parked}
          </span>
        )}
      </button>
      <div className="pointer-events-none absolute w-[220px] -translate-x-1/2 text-center" style={{ left: 0, top: ring + 8 }}>
        <div className={cx('truncate font-display font-semibold [text-shadow:0_0_3px_#000,0_1px_10px_rgba(0,0,0,.95)]', rs >= 30 ? 'text-[15px]' : 'text-[13px]', current ? 'text-white' : 'text-text')}>{project.name}</div>
        {showMeta && (
          <div className="tabular truncate text-[11.5px] text-muted [text-shadow:0_0_3px_#000,0_1px_8px_rgba(0,0,0,.95)]">
            {stats.total === 0 ? 'No tasks yet' : `${stats.open} open${stats.parked ? ` · ${stats.parked} parked` : ''} · ${pct}%`}
            {stats.openEffortMin > 0 && ` · ${fmtMinutes(stats.openEffortMin)} left`}
          </div>
        )}
      </div>
    </div>
  );
}

const PRIORITY_MIX = { 1: 40, 2: 66, 3: 88, 4: 100 } as const;

function PlanetNode({
  tv,
  color,
  x,
  y,
  d,
  lightAngle,
  today,
  showLabel,
  labelAbove,
  selected,
  dimmed,
  onClick,
}: {
  tv: TaskView;
  color: string;
  x: number;
  y: number;
  d: number;
  lightAngle: number;
  today: string;
  showLabel: boolean;
  labelAbove: boolean;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const { task, active, blocked, progress } = tv;
  const done = task.status === 'done';
  const parked = task.status === 'parked';
  const days = task.due ? daysBetween(today, task.due) : null;
  const overdue = !done && days != null && days < 0;
  const soon = !done && days != null && days >= 0 && days <= 1;
  // Lit from the star's side.
  const hx = 50 + Math.cos(lightAngle) * 24;
  const hy = 50 + Math.sin(lightAngle) * 24;
  const body = done ? '#5d6478' : `color-mix(in srgb, ${color} ${PRIORITY_MIX[task.priority]}%, #5d6478)`;
  const r = d / 2 + 5;
  const C = 2 * Math.PI * r;
  const desc = [
    task.title,
    active ? 'in focus now' : done ? 'done' : parked ? 'parked' : blocked ? 'waiting on another task' : null,
    `${PRIORITY_META[task.priority].label} priority`,
    task.estimateMin ? `about ${fmtMinutes(task.estimateMin)}` : null,
    task.due && !done ? describeDue(task.due, today).label : null,
    progress > 0 && !done ? `${progress}% done` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const atmosphere = overdue ? '#f2766b' : soon ? '#f5b544' : null;
  const style: CSSProperties = { left: x, top: y, width: 0, height: 0, opacity: dimmed ? 0.22 : done ? 0.6 : 1, zIndex: selected ? 26 : 20 };
  return (
    <div className="anim-pop absolute" style={style}>
      <button onClick={onClick} onPointerDown={(e) => e.stopPropagation()} aria-label={desc} title={desc} className="group absolute rounded-full outline-none" style={{ left: -r - 2, top: -r - 2, width: 2 * r + 4, height: 2 * r + 4 }}>
        {overdue && <span className="anim-pulse absolute rounded-full" style={{ inset: 3, boxShadow: '0 0 0 2px #f2766b, 0 0 14px 2px rgba(242,118,107,.55)' }} />}
        <svg className="absolute inset-0 -rotate-90 overflow-visible" width={2 * r + 4} height={2 * r + 4} aria-hidden>
          {parked && <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke="#f5b544" strokeWidth={1.5} strokeDasharray="3 4" opacity={0.85} />}
          {progress > 0 && !done && <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke="#2dd4bf" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress / 100)} />}
        </svg>
        <span
          className="absolute flex items-center justify-center rounded-full text-white transition-transform duration-150 group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-accent/60"
          style={{
            left: r + 2 - d / 2,
            top: r + 2 - d / 2,
            width: d,
            height: d,
            background: `radial-gradient(circle at ${hx}% ${hy}%, rgba(255,255,255,.75) 0%, ${body} 34%, color-mix(in srgb, ${body} 45%, black) 100%)`,
            boxShadow: [atmosphere && !overdue ? `0 0 0 2px ${atmosphere}, 0 0 12px 2px ${atmosphere}88` : '', active ? '0 0 0 3px #2dd4bf, 0 0 22px 4px rgba(45,212,191,.65)' : '', selected ? '0 0 0 3px #0a0c12, 0 0 0 5px #8b7cf6' : '']
              .filter(Boolean)
              .join(', ') || undefined,
          }}
        >
          {active ? (
            <span className="anim-pulse h-2.5 w-2.5 rounded-full bg-[#2dd4bf] shadow-[0_0_8px_#2dd4bf]" />
          ) : done ? (
            <Check size={Math.max(11, d * 0.4)} strokeWidth={3} className="drop-shadow" />
          ) : parked ? (
            <Pause size={Math.max(10, d * 0.36)} strokeWidth={2.8} className="drop-shadow" />
          ) : blocked ? (
            <Lock size={Math.max(10, d * 0.32)} strokeWidth={2.4} className="drop-shadow" />
          ) : null}
        </span>
      </button>
      {(showLabel || selected) && (
        <div
          className={cx('pointer-events-none absolute flex w-[170px] -translate-x-1/2 justify-center text-center text-[11.5px] leading-tight', labelAbove && 'items-end', done ? 'text-faint line-through' : 'text-text')}
          style={labelAbove ? { left: 0, bottom: r + 5 } : { left: 0, top: r + 5 }}
        >
          <span className="line-clamp-2 [text-shadow:0_1px_8px_rgba(0,0,0,.95)]">{task.title}</span>
        </div>
      )}
    </div>
  );
}

function QuickAddSlot({ projectId, color, x, y, active, onOpen, onClose }: { projectId: string; color: string; x: number; y: number; active: boolean; onOpen: () => void; onClose: () => void }) {
  const createTask = useOrbit((s) => s.createTask);
  const [title, setTitle] = useState('');
  return (
    <div className="absolute" style={{ left: x, top: y, width: 0, height: 0, zIndex: active ? 40 : 19 }}>
      {!active ? (
        <button
          onClick={onOpen}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Add a task to this system"
          title="Add a task"
          className="absolute flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-dashed text-muted transition-colors hover:text-white"
          style={{ left: -15, top: -15, borderColor: `${color}90` }}
        >
          <Plus size={16} />
        </button>
      ) : (
        <form
          data-ui
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            createTask({ projectId, title });
            setTitle('');
          }}
          className="absolute"
          style={{ left: -15, top: -20 }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
            onBlur={() => !title.trim() && onClose()}
            placeholder="New task — Enter to add"
            aria-label="New task title"
            className="h-10 w-64 rounded-xl border-2 bg-raised px-3 text-sm text-text shadow-panel outline-none placeholder:text-faint"
            style={{ borderColor: color }}
          />
        </form>
      )}
    </div>
  );
}

function FiltersButton() {
  const filter = useOrbit((s) => s.filter);
  const setFilter = useOrbit((s) => s.setFilter);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const rows: [keyof typeof filter, string, string][] = [
    ['dueSoon', 'Due soon', 'Overdue or due within 3 days'],
    ['highPriority', 'High priority', 'High and critical only'],
    ['parkedOnly', 'Parked', 'Only tasks with saved context'],
    ['showDone', 'Show done', 'Include completed tasks'],
  ];
  const count = rows.filter(([k]) => k !== 'showDone' && filter[k]).length;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Filters${count ? `, ${count} on` : ''}`}
        title="Filters"
        className={cx('inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium shadow-panel backdrop-blur-xl', count ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface/80 text-muted hover:text-text')}
      >
        <SlidersHorizontal size={15} /> <span className="hidden xl:inline">Filters</span>
        {count > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{count}</span>}
      </button>
      {open && (
        <div className="anim-pop absolute top-12 right-0 z-30 w-64 rounded-2xl border border-line-strong bg-raised p-2 shadow-panel">
          {rows.map(([key, label, hint]) => (
            <button key={key} role="menuitemcheckbox" aria-checked={!!filter[key]} onClick={() => setFilter({ [key]: !filter[key] })} className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-surface-3">
              <span className={cx('mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border-2', filter[key] ? 'border-accent bg-accent text-white' : 'border-line-strong')}>{filter[key] && <Check size={12} strokeWidth={3} />}</span>
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Minimap({ galaxies, view, size, onFly, onPan }: { galaxies: GalaxyPlace[]; view: View; size: Size; onFly: (t: Target) => void; onPan: (v: View) => void }) {
  const W = 176;
  const H = 112;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const g of galaxies) {
    minX = Math.min(minX, g.x - g.r);
    maxX = Math.max(maxX, g.x + g.r);
    minY = Math.min(minY, g.y - g.r);
    maxY = Math.max(maxY, g.y + g.r);
  }
  const pad = 8;
  const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
  const ox = pad + (W - pad * 2 - (maxX - minX) * s) / 2;
  const oy = pad + (H - pad * 2 - (maxY - minY) * s) / 2;
  const mx = (x: number) => ox + (x - minX) * s;
  const my = (y: number) => oy + (y - minY) * s;
  const tl = screenToWorld(view, 0, 0);
  const br = screenToWorld(view, size.w, size.h);
  const rx = clamp(mx(tl.x), -2, W + 2);
  const ry = clamp(my(tl.y), -2, H + 2);
  const rw = clamp(mx(br.x), -2, W + 2) - rx;
  const rh = clamp(my(br.y), -2, H + 2) - ry;
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = minX + (e.clientX - rect.left - ox) / s;
    const wy = minY + (e.clientY - rect.top - oy) / s;
    const g = galaxies.find((x) => Math.hypot(x.x - wx, x.y - wy) < x.r);
    if (g) onFly({ kind: 'galaxy', id: g.id });
    else onPan({ ...view, x: size.w / 2 - wx * view.k, y: size.h / 2 - wy * view.k });
  };
  return (
    <div data-ui className="absolute bottom-4 left-4 hidden rounded-xl border border-line bg-surface/80 p-1 shadow-panel backdrop-blur-xl md:block">
      <svg width={W} height={H} onClick={click} className="block cursor-pointer" role="img" aria-label="Minimap: click a galaxy to fly there">
        {galaxies.map((g) => (
          <g key={g.id}>
            <circle cx={mx(g.x)} cy={my(g.y)} r={Math.max(4, g.r * s)} fill={g.hex} fillOpacity={g.virtual ? 0.06 : 0.18} stroke={g.hex} strokeOpacity={0.5} strokeDasharray={g.virtual ? '2 2' : undefined} />
            {!g.virtual && <circle cx={mx(g.x)} cy={my(g.y)} r={2} fill="#fff" />}
            {g.systems.map((sy) => (
              <circle key={sy.pv.project.id} cx={mx(sy.x)} cy={my(sy.y)} r={1.4} fill={colorHex(sy.pv.project.color)} />
            ))}
          </g>
        ))}
        {rw > 0 && rh > 0 && <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={1.2} rx={2} />}
      </svg>
    </div>
  );
}

function Legend({ onClose }: { onClose: () => void }) {
  const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <li className="flex items-center gap-3">
      <span className="flex w-8 shrink-0 justify-center">{icon}</span>
      <span>{children}</span>
    </li>
  );
  return (
    <div data-ui className="anim-pop absolute top-12 right-0 z-30 w-[340px] rounded-2xl border border-line-strong bg-raised p-4 text-[13px] leading-snug shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold">Reading the universe</h3>
        <IconButton label="Close" size="xs" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <ul className="space-y-2.5 text-muted">
        <Row icon={<span className="h-5 w-5 rounded-full bg-[radial-gradient(circle,#fff_0%,#8b7cf6_35%,transparent_70%)]" />}>Galaxy: a group of projects. Denser spiral = more open work.</Row>
        <Row icon={<span className="h-5 w-5 rounded-full border-[3px] border-accent bg-[radial-gradient(circle_at_40%_36%,#fff,#8b7cf6)]" style={{ borderRightColor: 'rgba(255,255,255,.15)', borderBottomColor: 'rgba(255,255,255,.15)' }} />}>
          Star: a project. Ring = share of estimated work done. Bigger star = more open work.
        </Row>
        <Row icon={<span className="flex items-end gap-1"><span className="h-3 w-3 rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff,#8b7cf6_40%,#2a2350)]" /><span className="h-5 w-5 rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff,#8b7cf6_40%,#2a2350)]" /></span>}>Planet: a task. Size = estimated effort.</Row>
        <Row icon={<span className="flex gap-1"><span className="h-4 w-4 rounded-full bg-[#7b7f93]" /><span className="h-4 w-4 rounded-full bg-[#8b7cf6]" /></span>}>Colour strength: priority, from grey (low) to vivid (critical).</Row>
        <Row icon={<span className="flex gap-1"><span className="h-4 w-4 rounded-full shadow-[0_0_0_2px_#f2766b]" /><span className="h-4 w-4 rounded-full shadow-[0_0_0_2px_#f5b544]" /></span>}>Red glow: overdue. Amber glow: due today or tomorrow.</Row>
        <Row icon={<span className="h-5 w-5 rounded-full border-[3px] border-[#2dd4bf]" style={{ borderLeftColor: 'transparent', borderBottomColor: 'transparent' }} />}>Teal arc: progress on the task.</Row>
        <Row icon={<span className="h-4 w-4 rounded-full bg-[#2dd4bf] shadow-[0_0_12px_#2dd4bf]" />}>Teal glow: in focus right now.</Row>
        <Row icon={<Pause size={16} className="text-text" />}>Parked, place saved (amber dashed orbit).</Row>
        <Row icon={<Lock size={15} className="text-text" />}>Waiting on another task; dashed arrows show what blocks what.</Row>
      </ul>
      <p className="mt-3 border-t border-line pt-3 text-xs text-faint">
        Click a galaxy or star to fly in · Esc goes up · [ ] previous / next · 0 whole universe · double-click to zoom · drag stars to rearrange, or onto another galaxy to move them · drag a galaxy’s name to move the galaxy.
      </p>
    </div>
  );
}
