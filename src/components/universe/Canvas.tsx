import { isYours } from '../../host/caps';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, CircleDashed, CircleHelp, Diamond, Lock, Maximize, Minus, Moon, Orbit, Pause, Plus, Search, SlidersHorizontal, Sparkles, Check, CornerLeftUp, X, ExternalLink } from 'lucide-react';
import { orbit, useOrbit } from '../../store/store';
import { colorHex, inkOn } from '../../lib/colors';
import { useHotkeys } from '../../lib/hooks';
import { localGet, localSet } from '../../lib/local';
import { clamp, daysBetween, describeDue, fmtMinutes, toDateKey } from '../../lib/util';
import { IconButton, Menu, cx } from '../ui/primitives';
import { ProjectGlyph, PRIORITY_META } from '../ui/visuals';
import { filterActive, useUniverseModel, type ItemView, type TaskView } from './model';
import { useAbilities } from '../../host/useAbilities';
import type { MoonSet } from '../../host/adapt';
import { ChangedBadge, ChangedPill, ChangedRim, NotEqual } from './ChangedMark';
import { changedText } from '../../host/changed';
import type { Also, Arrow, Beacon, Family } from '../../host/types';
import { verseSwitch } from '../../host/verses';
import { arrowCurves, placeArrowChips, planetSpots, starBoxes, type PlacedChip } from './arrows';
import { VerseBar } from './VerseBar';
import { useOfferedVerses, WormholeMark, wormholeText } from '../host/Wormholes';
import { galaxyLabelHeight, placeGalaxyLabels } from './galaxyLabels';
import {
  buildSpace,
  galaxyBeaconSpot,
  systemBeaconSpot,
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
import { circleRect, moonListPlacement, outsideSystem, overlaps, type Measure, type OrbitLabel } from './labels';
import { layoutSky, STAR_NAME_W, starNameLines, starShowsMeta, starNameRect, starRadius } from './skyLabels';
import { requestPanelSection } from '../task/panelSection';

/** Text widths for label layout, measured with the same font the labels use (an estimate without a canvas). */
let measureCtx: CanvasRenderingContext2D | null | undefined;
const measureWith =
  (font: string, per: number): Measure =>
  (t: string) => {
    if (measureCtx === undefined) {
      try {
        measureCtx = typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent) ? document.createElement('canvas').getContext('2d') : null;
      } catch {
        measureCtx = null;
      }
    }
    if (!measureCtx) return t.length * per;
    measureCtx.font = font;
    return measureCtx.measureText(t).width;
  };
const measureLabel = measureWith('400 11.5px Inter Variable, system-ui, sans-serif', 6.1);
const measureDate = measureWith('600 11px Inter Variable, system-ui, sans-serif', 6.2);

const VIEW_KEY = 'orbit-space-view';
const NO_ARROWS: Arrow[] = [];
const NO_CHIPS: PlacedChip[] = [];
const measureGalaxyName = (name: string) => measureWith('600 15px Space Grotesk Variable, system-ui, sans-serif', 9.6)(name.toUpperCase()) + name.length * 2.1;
/** The counts under a galaxy's name (TASK counts; items as "n items"). */
function galaxyCountText(g: GalaxyPlace): string {
  if (g.systems.length === 0) return g.host ? 'Empty' : 'Empty — add a system';
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
  const sys = `${g.systems.length} system${g.systems.length === 1 ? '' : 's'}`;
  const items = g.items ? `${g.items} item${g.items === 1 ? '' : 's'}` : '';
  if (!g.total) return [sys, items].filter(Boolean).join(' · ');
  return [sys, `${g.open} open`, items, `${pct}%`].filter(Boolean).join(' · ');
}
type Target = { kind: 'universe' } | { kind: 'galaxy'; id: string } | { kind: 'system'; id: string };
type Drag =
  | { kind: 'system'; id: string; wx: number; wy: number; origin: string; target: string | null }
  | { kind: 'galaxy'; id: string; x: number; y: number }
  | null;

function loadView(): View | null {
  try {
    const v = JSON.parse(localGet(VIEW_KEY) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k) ? v : null;
  } catch {
    return null;
  }
}

const reducedMotion = () => document.documentElement.dataset.motion === 'reduce';

export function UniverseCanvas({ onNewSystem, onNewGalaxy }: { onNewSystem: (galaxyId: string | null) => void; onNewGalaxy: () => void }) {
  const model = useUniverseModel();
  // the verse on screen: the work verse (groups/projects/tasks), or another one (host.sky: no tasks, no own records)
  const sky = useOrbit((s) => s.host?.sky ?? null);
  const groups = useOrbit((s) => s.host?.sky?.groups ?? s.groups);
  const workDeep = useOrbit((s) => s.prefs.deepSpace);
  const deepSpace = sky?.deepSpace ?? workDeep;
  const filter = useOrbit((s) => s.filter);
  const selection = useOrbit((s) => s.selection);
  const flight = useOrbit((s) => s.flight);
  const host = useOrbit((s) => s.host);
  const layers = useOrbit((s) => s.prefs.layers);
  const can = useAbilities();
  const verses = useOfferedVerses();
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
  // Galaxies a host marks finished stay out of the sky (with their systems) unless asked for.
  const shownGroups = useMemo(() => (filter.showFinished ? groups : groups.filter((g) => !g.host?.finished)), [groups, filter.showFinished]);
  const shownModel = useMemo(() => {
    if (shownGroups.length === groups.length) return model;
    const hidden = new Set(groups.filter((g) => !shownGroups.includes(g)).map((g) => g.id));
    return model.filter((pv) => !pv.project.groupId || !hidden.has(pv.project.groupId));
  }, [model, groups, shownGroups]);
  const extras = useMemo(
    () => (sky ? { beacons: sky.beacons, attachments: {}, collections: sky.collections } : host ? { beacons: host.beacons, attachments: host.attachments, collections: host.collections } : undefined),
    [sky, host?.beacons, host?.attachments, host?.collections], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const families = sky?.families ?? host?.families;
  const clusters = sky?.clusters ?? host?.clusters;
  const arrowList: Arrow[] = sky?.arrows ?? host?.arrows ?? NO_ARROWS;
  /** A system of the verse on screen, by id. */
  const projectOf = (id: string) => (orbit().host?.sky?.projects ?? orbit().projects).find((p) => p.id === id);
  const galaxies = useMemo(
    () => buildSpace(shownModel, shownGroups, deepSpace, dim, spaceDrag, extras),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownModel, shownGroups, deepSpace, dim, extras, drag?.kind, drag?.id, drag && 'wx' in drag ? drag.wx : drag?.x, drag && 'wy' in drag ? drag.wy : drag?.y],
  );
  const galaxiesRef = useRef(galaxies);
  galaxiesRef.current = galaxies;
  const today = toDateKey(Date.now());

  /* ---------- view state ---------- */

  const setView = useCallback((v: View) => {
    setViewState(v);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      localSet(VIEW_KEY, JSON.stringify(v));
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
      if (s) return fitSystem(s, sz, measureDate);
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
      if (v) {
        // kept framed like any flight to the universe: a toolbar or banner that changes height refits it
        locked.current = { kind: 'universe' };
        setView(v);
      }
      return;
    }
    if (locked.current && !anim.current) {
      const v = viewFor(locked.current);
      if (v) setView(v);
    }
  }, [size.w, size.h, size.top, viewFor, setView]);

  // Requests from elsewhere (search, panels). After a verse switch the jump is at once (the crossfade hides it).
  const lastFlight = useRef(0);
  useEffect(() => {
    if (!flight || flight.nonce === lastFlight.current || !size.w) return;
    const t: Target = flight.kind === 'universe' || !flight.id ? { kind: 'universe' } : ({ kind: flight.kind, id: flight.id } as Target);
    if (flight.instant) {
      const v = viewFor(t);
      if (!v) return; // the verse's sky is not drawn yet: try again when it is
      lastFlight.current = flight.nonce;
      stopAnim();
      locked.current = t;
      setQuickAdd(null);
      setView(v);
      return;
    }
    lastFlight.current = flight.nonce;
    flyTo(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, size.w, flyTo, galaxies]);

  /* ---------- switching verse: a plain crossfade from the old sky ---------- */

  const fade = useRef<HTMLCanvasElement>(null);
  useEffect(
    () =>
      verseSwitch.on(() => {
        const to = fade.current;
        const from = box.current?.querySelector<HTMLCanvasElement>('canvas[data-sky]');
        if (!to || !from || reducedMotion() || !from.width) return;
        to.width = from.width;
        to.height = from.height;
        const g = to.getContext('2d');
        if (!g) return;
        g.drawImage(from, 0, 0);
        to.style.transition = 'none';
        to.style.opacity = '1';
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            to.style.transition = 'opacity 200ms ease-out';
            to.style.opacity = '0';
          }),
        );
      }),
    [],
  );

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
        const project = projectOf(drag.id);
        if (target && target.id !== drag.origin && (project?.host || target.host)) {
          // a host's system leaving its galaxy, or one of ORBIT's own into a host's galaxy: the store refuses and says why
          updateProject(drag.id, { groupId: target.id === DEEP_SPACE_ID ? null : target.id });
        } else if (target && target.id !== drag.origin && project) {
          const before = { groupId: project.groupId, x: project.x, y: project.y };
          const at = settleInGalaxy(target, drag.wx, drag.wy, drag.id);
          updateProject(drag.id, { groupId: target.id === DEEP_SPACE_ID ? null : target.id, x: at.x, y: at.y });
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
  /** The system's panel, scrolled to what it holds that no task uses (its belt). */
  const showBelt = (projectId: string) => {
    if (suppressClick.current) return;
    requestPanelSection(projectId, 'belt');
    select({ type: 'project', id: projectId });
  };
  const onPlanetClick = (s: SystemPlace, taskId: string) => {
    select({ type: 'task', id: taskId });
    if (ctx.system?.pv.project.id !== s.pv.project.id) flyTo({ kind: 'system', id: s.pv.project.id });
  };
  const onItemClick = (s: SystemPlace, itemId: string) => {
    select({ type: 'item', id: itemId });
    if (ctx.system?.pv.project.id !== s.pv.project.id) flyTo({ kind: 'system', id: s.pv.project.id });
  };
  /** A portal's chip: the other verse, in the same galaxy. */
  const throughPortal = (s: SystemPlace) => {
    if (suppressClick.current || !s.portal) return;
    void useOrbit.getActions().showVerse(s.portal.verse, { galaxy: s.galaxyId === DEEP_SPACE_ID ? undefined : s.galaxyId });
  };
  const [hovered, setHovered] = useState<string | null>(null);

  /* ---------- render ---------- */

  const k = view?.k ?? 1;
  const toS = (wx: number, wy: number) => [wx * k + (view?.x ?? 0), wy * k + (view?.y ?? 0)] as const;
  const onScreen = (sx: number, sy: number, r: number) => sx + r > -40 && sy + r > -40 && sx - r < size.w + 40 && sy - r < size.h + 40;
  const query = filter.query.trim();
  const selectedPlanet = selection?.type === 'task' || selection?.type === 'item' ? selection.id : null;
  // a narrow canvas (e.g. with the detail panel open): the toolbar keeps to one row with icons
  const compact = size.w > 0 && size.w < 1180;
  const mini = minimapSize(size.w);
  // the corners the minimap and the zoom control take: no planet name goes under them
  const ui = useMemo(
    () => (size.w ? [{ x: 8, y: size.h - 16 - mini.h - 14, w: mini.w + 22, h: mini.h + 30 }, { x: size.w - 200, y: size.h - 70, w: 200, h: 70 }] : []),
    [size.w, size.h, mini.w, mini.h],
  );
  const skyWords = useMemo(
    () =>
      view && size.w
        ? layoutSky({ galaxies, view, size, universeLevel: level === 'universe', selectedTask: selectedPlanet, today, beacons: layers.beacons, measure: measureLabel, measureBold: measureDate, ui })
        : { planets: new Map<string, OrbitLabel>(), crowded: new Set<string>() },
    [galaxies, view, size, level, selectedPlanet, today, layers.beacons, ui],
  );
  // a verse's relations ("made from"): drawn when both planets are, with labels for the selected or hovered one
  const arrowStars = useMemo(() => (view && arrowList.length ? starBoxes(galaxies, view, measureLabel) : undefined), [arrowList, galaxies, view]);
  const curves = useMemo(() => (view && arrowList.length ? arrowCurves(arrowList, planetSpots(galaxies, view, level === 'universe', size), arrowStars) : []), [arrowList, galaxies, view, level, size, arrowStars]);
  const planetTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of galaxies) for (const sy of g.systems) {
      for (const tv of sy.pv.tasks) m.set(tv.task.id, tv.task.title);
      for (const iv of sy.pv.items ?? []) m.set(iv.item.id, iv.item.title);
    }
    return m;
  }, [galaxies]);
  const arrowFocus = useMemo(() => new Set([selectedPlanet, hovered].filter((x): x is string => !!x)), [selectedPlanet, hovered]);
  // the chips of the arrows being looked at: shortened names, placed clear of planets, stars and each other; a planet
  // name a chip has to sit on is hidden (it shows on hover)
  const chips = useMemo(() => {
    if (!view || !arrowList.length || !size.w) return NO_CHIPS;
    const inputs = curves
      .filter((c) => c.label && (arrowFocus.has(c.from) || arrowFocus.has(c.to)))
      .map((c) => ({ from: c.from, to: c.to, label: c.label!, fromTitle: planetTitles.get(c.from) ?? '', toTitle: planetTitles.get(c.to) ?? '', curve: c }));
    if (!inputs.length) return NO_CHIPS;
    const disks = planetSpots(galaxies, view, level === 'universe', size);
    return placeArrowChips(inputs, { measure: measureLabel, measureBold: measureDate, disks, stars: arrowStars, labels: skyWords.planets, ui, bounds: { x: 4, y: size.top ?? 76, w: size.w - 8, h: size.h - (size.top ?? 76) - 4 } });
  }, [view, arrowList, size, curves, arrowFocus, planetTitles, galaxies, level, arrowStars, skyWords, ui]);
  const words = useMemo(() => {
    const hidden = new Set(chips.flatMap((c) => c.hides));
    if (!hidden.size) return skyWords;
    const planets = new Map(skyWords.planets);
    for (const id of hidden) {
      const l = planets.get(id);
      if (l) planets.set(id, { ...l, shown: false });
    }
    return { ...skyWords, planets };
  }, [skyWords, chips]);
  // the whole universe: galaxies' names and counts never cover each other
  const galaxyLabels = useMemo(
    () =>
      view && size.w && level === 'universe'
        ? placeGalaxyLabels(
            galaxies.map((g) => {
              const [cx, cy] = [g.x * view.k + view.x, g.y * view.k + view.y];
              const counts = galaxyCountText(g) + (g.overdue ? ` · ${g.overdue} overdue` : '') + (g.changed ? ` · ≠ ${changedText(g.changed)}` : '');
              const own = isYours(can.hosted, g);
              const chipW = g.host?.chip ? measureLabel(g.host.chip) + 40 : own ? 80 : 0;
              return { id: g.id, cx, cy, sr: g.r * view.k, w: Math.max(150, measureGalaxyName(g.name) + 34, measureLabel(counts) + 34, chipW), chip: !!g.host?.chip || own, changed: g.changed > 0 };
            }),
            { w: size.w, h: size.h, top: size.top ?? 76 },
          )
        : null,
    [galaxies, view, size, level, can.hosted],
  );

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
        {view && (
          <SpacePainter
            view={view}
            size={size}
            galaxies={galaxies}
            dim={dim}
            today={today}
            showDeps={k >= LOD.planets}
            universeLevel={level === 'universe'}
            dropTarget={drag?.kind === 'system' && drag.target && drag.target !== drag.origin ? drag.target : null}
            draggingId={drag?.kind === 'system' ? drag.id : null}
            families={families}
            clusters={clusters}
            layers={layers}
            planetLabels={words.planets}
            crowded={words.crowded}
            arrows={curves}
            arrowFocus={arrowFocus}
            galaxyBoxes={galaxyLabels ?? undefined}
            hosted={can.hosted}
            selectedPlanet={selectedPlanet}
            focusSystem={ctx.system?.pv.project.id ?? null}
          />
        )}

        <canvas ref={fade} className="pointer-events-none absolute inset-0 z-[5] h-full w-full" style={{ opacity: 0 }} aria-hidden />

        {/* what a relation says, on a backing above stars, names and planets; only for the selected or hovered planet's arrows */}
        {view &&
          chips.map((c) => (
            <div
              key={`al-${c.from}-${c.to}`}
              data-arrow-label={`${c.from}>${c.to}`}
              title={c.full}
              className="pointer-events-none absolute z-[45] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-full border border-[#8fd8ff]/60 bg-[#060914]/95 px-2.5 text-[11.5px] whitespace-nowrap shadow-panel"
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            >
              <span className="text-muted">{c.fromText}</span>
              <span className="font-semibold text-[#d6f1ff]">{c.label}</span>
              <span aria-hidden className="text-[#8fd8ff]">→</span>
              <span className="text-muted">{c.toText}</span>
            </div>
          ))}

        {view &&
          galaxies.map((g) => {
            const [cx, cy] = toS(g.x, g.y);
            const sr = g.r * k;
            if (!onScreen(cx, cy, sr * 1.2) || k > 1.05) return null;
            const universe = level === 'universe';
            const spot = galaxyLabels?.get(g.id);
            // a galaxy fitted closer than its whole disc has its rim above the view: its name stays under the toolbar
            const labelBottom = (cyy: number, srr: number) => Math.max(cyy - srr - 6, (size.top ?? 76) + 48);
            // its words never show through the minimap or the zoom control (nor the toolbar's row)
            const lw = Math.max(universe ? 150 : 90, measureGalaxyName(g.name) + 34, measureLabel(galaxyCountText(g) + (g.changed ? ` · ≠ ${changedText(g.changed)}` : '')) + 34, g.host?.chip ? measureLabel(g.host.chip) + 40 : 0);
            const lh = universe ? galaxyLabelHeight(!!g.host?.chip || isYours(can.hosted, g), !!spot?.brief, g.changed > 0) : 44;
            const lx = universe && spot ? (spot.side === 'left' ? spot.x + spot.w - lw : spot.side === 'right' ? spot.x : spot.x + spot.w / 2 - lw / 2) : cx - lw / 2;
            const ly = universe ? (spot?.y ?? cy + Math.min(sr * 0.92, sr * 0.5 + 70)) : labelBottom(cy, sr) - lh;
            const under = ui.some((r) => overlaps({ x: lx, y: ly, w: lw, h: lh }, r));
            return (
              <GalaxyLabel
                key={g.id}
                clipped={under}
                g={g}
                x={universe && spot ? (spot.side === 'left' ? spot.x + spot.w : spot.side === 'right' ? spot.x : spot.x + spot.w / 2) : cx}
                beside={universe && spot && (spot.side === 'left' || spot.side === 'right') ? spot.side : undefined}
                y={universe ? (spot?.y ?? cy + Math.min(sr * 0.92, sr * 0.5 + 70)) : labelBottom(cy, sr)}
                compact={!universe}
                brief={universe && !!spot?.brief}
                yours={isYours(can.hosted, g)}
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
                  close={k >= LOD.planets && !s.busy}
                  faded={ctx.system?.pv.project.id !== s.pv.project.id && sy - clamp(s.pv.radius * k, 9, 66) < (size.top ?? 76)}
                  away={!!ctx.system && ctx.system.pv.project.id !== s.pv.project.id && k >= LOD.planets}
                  clipped={ui.some((r) => overlaps(circleRect(sx, sy, starRadius(s, k) + 8), r) || overlaps(starNameRect(s, sx, sy, k, measureLabel), r))}
                  dimmed={dim && !s.pv.matches}
                  dragging={drag?.kind === 'system' && drag.id === s.pv.project.id}
                  onPointerDown={(e) => startDrag(e, 'system', s.pv.project.id, s.x, s.y, g.id)}
                  onClick={() => onStarClick(s)}
                  portalTo={s.portal ? (s.portal.label ?? `to ${verses.get(s.portal.verse)?.name ?? s.portal.verse}`) : undefined}
                  onPortal={() => throughPortal(s)}
                />
              );
            }),
          )}

        {view &&
          layers.belts &&
          k >= LOD.planets &&
          level !== 'universe' &&
          galaxies.flatMap((g) =>
            g.systems.map((s) => {
              if (!s.belt) return null;
              const [sx, sy] = toS(s.x, s.y);
              const R = s.belt.r * k;
              if (!onScreen(sx, sy, R + 40)) return null;
              const band = Math.max(14, (s.belt.haze ? 34 : 20) * k);
              const open = () => showBelt(s.pv.project.id);
              const label = `${s.belt.collection.total} items held here that no task uses yet. Open the list.`;
              return (
                <div key={`belt-${s.pv.project.id}`} className="contents">
                  {/* the belt itself: only its band takes clicks */}
                  <svg className="pointer-events-none absolute z-[17] overflow-visible" style={{ left: sx, top: sy }} width={1} height={1} aria-hidden>
                    <circle r={R} fill="none" stroke="transparent" strokeWidth={band} className="pointer-events-[stroke] cursor-pointer" style={{ pointerEvents: 'stroke' }} onPointerDown={(e) => e.stopPropagation()} onClick={open}>
                      <title>{label}</title>
                    </circle>
                  </svg>
                  <button
                    aria-label={label}
                    title="Open the list in the system’s panel"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={open}
                    className="absolute z-[19] h-9 w-[360px] -translate-x-1/2 rounded-lg outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent"
                    style={{ left: sx, top: sy + R + 14 * Math.max(1, k) - 6 }}
                  />
                </div>
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
                  aria-label={`${name} in ${g.name}.${s.pv.changed.moons ? ` ${changedText(s.pv.changed.moons)}.` : ''} Click to fly to this system; drag onto another galaxy to move it.`}
                  data-system={s.pv.project.id}
                  data-changed={s.pv.changed.moons || undefined}
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
            const kept = !!projectOf(drag.id)?.host;
            // a galaxy is the host's or ORBIT's own: a system crosses into the other kind only by being refused
            const across = !!target && target.id !== drag.origin && !kept && !!target.host;
            const moving = target && target.id !== drag.origin && !kept && !across;
            const origin = galaxies.find((g) => g.id === drag.origin);
            const outside = (!target || (kept && target.id !== drag.origin)) && origin && Math.hypot(drag.wx - origin.x, drag.wy - origin.y) >= origin.r + 400;
            if (!moving && !outside && !across) return null;
            return (
              <div className="pointer-events-none absolute z-40 -translate-x-1/2 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap shadow-panel" style={{ left: sx, top: sy - 44, background: moving ? 'var(--accent)' : 'var(--surface-3)', borderColor: moving ? 'transparent' : 'var(--line-strong)', color: moving ? '#fff' : 'var(--muted)' }}>
                {moving ? `Move to ${target!.id === DEEP_SPACE_ID ? 'deep space' : target!.name}` : kept ? `Kept by ${can.name}: release to put it back` : across ? `${target!.name} is kept by ${can.name}: release to put it back` : 'Release to put it back'}
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
                    label={words.planets.get(tv.task.id)}
                    selected={selection?.type === 'task' && selection.id === tv.task.id}
                    away={!!ctx.system && ctx.system.pv.project.id !== s.pv.project.id}
                    dimmed={dim && (!s.pv.matches || ((!!query || !!filter.uses || filter.hasChanged) && !tv.matches))}
                    onClick={() => onPlanetClick(s, tv.task.id)}
                    onHover={(on) => setHovered(on ? tv.task.id : null)}
                  />
                );
              });
              const nt = s.pv.tasks.length;
              s.pv.items.forEach((iv, j) => {
                const sl = s.slots[nt + j];
                if (!sl) return;
                nodes.push(
                  <ItemNode
                    key={iv.item.id}
                    iv={iv}
                    color={families?.[iv.item.family]?.color ?? '#c9d2ee'}
                    familyLabel={families?.[iv.item.family]?.label ?? iv.item.kind}
                    x={sx + sl.x * k}
                    y={sy + sl.y * k}
                    d={clamp(sl.d * k, 14, 64)}
                    lightAngle={Math.atan2(-sl.y, -sl.x)}
                    label={words.planets.get(iv.item.id)}
                    selected={selection?.type === 'item' && selection.id === iv.item.id}
                    away={!!ctx.system && ctx.system.pv.project.id !== s.pv.project.id}
                    dimmed={dim && (!s.pv.matches || ((!!query || filter.hasChanged) && !iv.matches))}
                    onClick={() => onItemClick(s, iv.item.id)}
                    onHover={(on) => setHovered(on ? iv.item.id : null)}
                  />,
                );
              });
              // the selected planet's moons, named, close up (never for every planet: too much to read)
              const selTask = selection?.type === 'task' ? s.pv.tasks.findIndex((tv) => tv.task.id === selection.id) : -1;
              const selItem = selection?.type === 'item' ? s.pv.items.findIndex((iv) => iv.item.id === selection.id) : -1;
              const selIdx = selTask >= 0 ? selTask : selItem >= 0 ? nt + selItem : -1;
              const selMoons = selTask >= 0 ? s.pv.tasks[selTask].moons : selItem >= 0 ? s.pv.items[selItem].item.moons : undefined;
              const selId = selTask >= 0 ? s.pv.tasks[selTask].task.id : selItem >= 0 ? s.pv.items[selItem].item.id : '';
              if (layers.moons && selMoons && (selMoons.items.length > 0 || selMoons.more > 0) && k >= LOD.planetLabels && s.slots[selIdx]) {
                const sl = s.slots[selIdx];
                const d = clamp(sl.d * k, 14, 64);
                const px = sx + sl.x * k;
                // outward from the star, clear of the planet's name, and inside the view
                // beside the planet, clear of its name; on the side away from the detail panel (on the right) when
                // there is room, inside the canvas, and never wider than a short list needs
                const lab = words.planets.get(selId);
                const off = Math.max(d / 2 + 18, lab?.shown && (lab.side === 'left' || lab.side === 'right') ? d / 2 + 14 + lab.rect.w : 0, 40);
                // the list goes outside the system (past its outer orbit or belt) where it fits, with a line to its
                // planet; only when nowhere outside fits does it sit beside the planet (away from the panel)
                const rows = Math.min(selMoons.items.length, 8) + (selMoons.items.length > 8 || selMoons.more ? 1 : 0);
                const h = rows * 31 + (selMoons.items.length > 8 || selMoons.more ? 14 : 0);
                const outer = (s.belt ? s.belt.r + 26 : (s.rings.at(-1) ?? 0) + 30) * k;
                const py = sy + sl.y * k;
                // never over another planet's name
                // (its own name included: the list never covers the selected planet's label either)
                const names = [...s.pv.tasks.map((tv) => tv.task.id), ...s.pv.items.map((iv) => iv.item.id)]
                  .map((pid) => words.planets.get(pid))
                  .filter((l): l is OrbitLabel => !!l?.shown)
                  .map((l) => l.rect);
                const out = outsideSystem({ sx, sy, py, outer, canvasW: size.w, canvasH: size.h, top: size.top ?? 76, w: 230, h, avoid: [...ui, ...names] });
                let near = moonListPlacement({ x: px, off, canvasW: size.w, panelRight: !!selection, cap: 240 });
                // beside the planet: when its name sits above or below, the list would still start under it, so it
                // is moved out past the name's end on its side
                let nearOff = off;
                if (!out && lab?.shown && py - h / 2 < lab.rect.y + lab.rect.h && py + h / 2 > lab.rect.y) {
                  const past = near.left ? px - lab.rect.x + 10 : lab.rect.x + lab.rect.w - px + 10;
                  if (past > nearOff) {
                    nearOff = past;
                    near = moonListPlacement({ x: px, off: nearOff, canvasW: size.w, panelRight: !!selection, cap: 240 });
                  }
                }
                const left = out ? out.left : near.left;
                const maxW = out ? out.box.w : near.maxW;
                const anchor = out ? (out.left ? out.box.x + out.box.w : out.box.x) : px;
                const top = out ? out.box.y : clamp(py - h / 2, (size.top ?? 76) + 4, Math.max((size.top ?? 76) + 4, size.h - h - 76));
                const lead = out
                  ? { from: { x: px, y: py }, to: { x: out.left ? out.box.x + out.box.w : out.box.x, y: Math.min(Math.max(py, out.box.y + 12), out.box.y + h - 12) } }
                  : undefined;
                nodes.push(
                  <MoonChips
                    key={`moons-${selId}`}
                    set={selMoons}
                    families={families ?? {}}
                    x={anchor}
                    top={top}
                    off={out ? 0 : nearOff}
                    left={left}
                    maxW={maxW}
                    lead={lead}
                    leadFrom={d / 2 + 6}
                    hostName={can.name}
                  />,
                );
              }
              const add = s.pv.canAdd ? s.slots[s.slots.length - 1] : undefined;
              // nothing to click is left under the toolbar
              if (add && sy + add.y * k > (size.top ?? 76))
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

        {view &&
          layers.beacons &&
          galaxies.flatMap((g) => {
            const spots: { b: Beacon; x: number; y: number; owner: string; first: boolean; n: number; group: boolean }[] = [];
            const [gx, gy] = toS(g.x, g.y);
            if (!onScreen(gx, gy, g.r * k * 1.2)) return [];
            g.beacons.forEach((b, i) => {
              const p = galaxyBeaconSpot(g, i);
              spots.push({ b, x: p.x, y: p.y, owner: g.id, first: i === 0, n: g.beacons.length, group: true });
            });
            if (k >= LOD.systems && level !== 'universe')
              for (const s of g.systems) s.beacons.forEach((b, i) => spots.push({ b, ...systemBeaconSpot(s, i), owner: s.pv.project.id, first: i === 0, n: s.beacons.length, group: false }));
            return spots.flatMap(({ b, x, y, owner, first, n, group }) => {
              const [bx, by] = toS(x, y);
              if (!onScreen(bx, by, 10)) return [];
              // dates too close together to label one by one: "n dates" opens the panel that lists them
              const count =
                first && words.crowded.has(owner) ? (
                  <button
                    key={`bc-${owner}`}
                    aria-label={`${n} dates. Open the list.`}
                    title={`${n} dates: open the list`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => select({ type: group ? 'group' : 'project', id: owner })}
                    className="absolute z-[21] h-5 -translate-y-1/2 rounded-md outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent"
                    style={{ left: bx + 6, top: by, width: measureDate(`${n} dates`) + 10 }}
                  />
                ) : null;
              return [
                count,
                (
                <button
                  key={`b-${b.id}`}
                  data-beacon={b.id}
                  aria-label={`Date: ${[b.code, b.title].filter(Boolean).join(' ')}, ${b.state}${b.due ? `, due ${b.due}` : ''}. Open details.`}
                  title={[b.code, b.title].filter(Boolean).join(' ')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => select({ type: 'beacon', id: b.id })}
                  className={cx('absolute z-[21] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-md outline-none hover:ring-2 hover:ring-white/60 focus-visible:ring-2 focus-visible:ring-accent', selection?.type === 'beacon' && selection.id === b.id && 'ring-2 ring-white/80')}
                  style={{ left: bx, top: by }}
                />
                ),
              ];
            });
          })}

        {galaxies.length === 0 && view && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">The universe is empty.</div>
        )}
      </div>

      {/* ---------- chrome ---------- */}
      <div ref={chrome} data-ui className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 md:p-4">
      <div className="flex flex-nowrap items-start gap-2">
        <Breadcrumbs ctx={ctx} galaxies={galaxies} onFly={flyTo} onUp={goUp} compact={compact} />
        <div className="flex-1" />
        <div className="pointer-events-auto flex shrink-0 flex-nowrap items-center justify-end gap-2">
          <div
            className={cx(
              'flex h-10 items-center gap-2 rounded-xl border border-line bg-surface/80 px-3 shadow-panel backdrop-blur-xl transition-[width] focus-within:border-accent',
              compact ? (filter.query ? 'w-44' : 'w-10 cursor-text focus-within:w-44') : 'w-40 xl:w-56',
            )}
            onClick={(e) => e.currentTarget.querySelector('input')?.focus()}
          >
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
          {can.hosted && <LayerSwitches compact={compact} />}
          <FiltersButton hosted={can.hosted} hasFinished={groups.some((g) => g.host?.finished)} compact={compact} />
          <div className="relative">
            <IconButton label="What the shapes mean" variant="secondary" active={legend} onClick={() => setLegend((l) => !l)} className="bg-surface/80 backdrop-blur-xl">
              <CircleHelp size={18} />
            </IconButton>
            {legend && <Legend onClose={() => setLegend(false)} hosted={can.hosted} hostName={can.name} verseLegend={verses.size > 1 ? verses.get(host?.shown ?? '')?.legend : undefined} recordsOnly={can.hosted && verses.size > 1 && !!host && host.shown !== host.verseId && verses.get(host.shown)?.editable === false} />}
          </div>
          {!can.personal && !sky && (
            <IconButton label="Tidy galaxies into a spiral" variant="secondary" onClick={() => useOrbit.getActions().arrangeGalaxiesSpiral()} disabled={galaxies.length < 2} className="bg-surface/80 backdrop-blur-xl">
              <Orbit size={18} />
            </IconButton>
          )}
          {can.personal && !sky && <Menu
            label="Create"
            trigger={(p) => (
              <button {...p} aria-label="New system or galaxy" title="New system or galaxy" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-medium text-white shadow-[0_6px_20px_-8px_var(--accent)] hover:brightness-110">
                <Plus size={16} /> {!compact && <span className="hidden xl:inline">New</span>} <ChevronDown size={14} />
              </button>
            )}
            items={[
              {
                // a host's galaxy holds only the host's systems: a new one of ORBIT's own starts in deep space
                label: ctx.galaxy && !ctx.galaxy.virtual && !ctx.galaxy.host ? `New system in ${ctx.galaxy.name}` : 'New system',
                icon: <Sparkles size={15} />,
                onSelect: () => onNewSystem(ctx.galaxy && !ctx.galaxy.virtual && !ctx.galaxy.host ? ctx.galaxy.id : null),
              },
              { label: 'New galaxy', icon: <Plus size={15} />, onSelect: onNewGalaxy },
              'sep',
              { label: 'Tidy galaxies into a spiral', icon: <Orbit size={15} />, onSelect: () => useOrbit.getActions().arrangeGalaxiesSpiral(), disabled: galaxies.length < 2 },
            ]}
          />}
        </div>
      </div>
      {can.hosted && <VerseBar ctxGalaxy={ctx.galaxy && !ctx.galaxy.virtual ? ctx.galaxy.id : null} compact={compact} />}
      </div>

      {view && galaxies.length > 0 && <Minimap galaxies={galaxies} view={view} size={size} W={mini.w} H={mini.h} onFly={flyTo} onPan={(v) => { locked.current = null; animateTo(v); }} />}

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

function Breadcrumbs({ ctx, galaxies, onFly, onUp, compact = false }: { ctx: { galaxy: GalaxyPlace | null; system: SystemPlace | null }; galaxies: GalaxyPlace[]; onFly: (t: Target) => void; onUp: () => void; compact?: boolean }) {
  const crumb = cx('inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-3', compact ? 'max-w-[150px]' : 'max-w-[200px]');
  const galaxyItems = galaxies.map((g) => ({
    label: `${g.name}${g.virtual ? '' : ` · ${g.systems.length}`}`,
    icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.hex }} />,
    onSelect: () => onFly({ kind: 'galaxy', id: g.id }),
  }));
  return (
    <nav aria-label="Where you are in the universe" className="pointer-events-auto flex min-w-0 shrink items-center gap-0.5 overflow-hidden rounded-xl border border-line bg-surface/80 p-1 shadow-panel backdrop-blur-xl">
      <IconButton label="Up a level (Esc)" size="sm" onClick={onUp} disabled={!ctx.galaxy}>
        <CornerLeftUp size={16} />
      </IconButton>
      <button className={cx(crumb, 'shrink-0', !ctx.galaxy ? 'text-text' : 'text-muted')} onClick={() => onFly({ kind: 'universe' })} aria-current={!ctx.galaxy ? 'location' : undefined} title="Universe">
        <Sparkles size={14} className="shrink-0 text-accent-ink" /> {!compact || !ctx.galaxy ? 'Universe' : <span className="sr-only">Universe</span>}
      </button>
      {ctx.galaxy ? (
        <>
          <ChevronRight size={14} className="shrink-0 text-faint" />
          <button className={cx(crumb, !ctx.system ? 'text-text' : 'text-muted')} onClick={() => onFly({ kind: 'galaxy', id: ctx.galaxy!.id })} aria-current={!ctx.system ? 'location' : undefined} title={ctx.galaxy.name}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ctx.galaxy.hex }} />
            <span className="truncate">{ctx.galaxy.name}</span>
          </button>
          <Menu label="Jump to galaxy" align="left" trigger={(p) => <IconButton {...p} label="Jump to another galaxy" size="xs"><ChevronDown size={14} /></IconButton>} items={galaxyItems} />
          {ctx.system ? (
            <>
              <ChevronRight size={14} className="shrink-0 text-faint" />
              <span className={cx(crumb, 'text-text hover:bg-transparent')} aria-current="location" title={ctx.system.pv.project.name}>
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
                title: s.pv.project.name,
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
  clipped = false,
  g,
  x,
  y,
  compact,
  brief = false,
  beside,
  yours = false,
  dimmed,
  inside,
  dragging,
  dropTarget,
  onPointerDown,
  onClick,
}: {
  /** Under the minimap or the zoom control: not drawn. */
  clipped?: boolean;
  g: GalaxyPlace;
  dropTarget?: boolean;
  x: number;
  y: number;
  compact: boolean;
  /** Universe level, crowded: the name (and chip) only; the counts show on hover. */
  brief?: boolean;
  /** Universe level, label placed beside its galaxy: the words hug the galaxy's side instead of floating in a wide box. */
  beside?: 'left' | 'right';
  /** Hosted: one of ORBIT's own galaxies (the host's carry their own chip). */
  yours?: boolean;
  dimmed: boolean;
  inside: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const auto = beside === 'left' ? 'ml-auto' : beside === 'right' ? 'mr-auto' : 'mx-auto';
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
  const counts = galaxyCountText(g);
  const label = `${g.name} galaxy: ${counts}.${g.overdue ? ` ${g.overdue} overdue.` : ''}${g.changed ? ` ${changedText(g.changed)}.` : ''}${inside && !g.virtual ? ' Open details.' : ' Fly in.'}`;
  return (
    <button
      aria-label={label}
      data-galaxy={g.id}
      data-changed={g.changed || undefined}
      title={g.virtual ? 'Projects without a galaxy — drag to move' : `${g.name}${brief ? ` (${counts})` : ''} — click to ${inside ? 'see details' : 'fly in'}, drag to move`}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={cx(
        'absolute z-10 rounded-2xl transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-accent',
        beside === 'left' ? '-translate-x-full text-right' : beside === 'right' ? 'text-left' : '-translate-x-1/2 text-center',
        compact ? '-translate-y-full px-3 py-1' : 'px-4 py-2 hover:bg-white/5',
        dragging ? 'cursor-grabbing' : 'cursor-pointer',
        dropTarget && 'bg-white/10 ring-2 ring-white/60',
        clipped && 'pointer-events-none',
      )}
      style={{ left: x, top: y, opacity: clipped ? 0 : dimmed ? 0.35 : 1 }}
      tabIndex={clipped ? -1 : undefined}
    >
      <span className={cx('block font-display font-semibold tracking-[0.14em] uppercase [text-shadow:0_1px_12px_rgba(0,0,0,.9)]', compact ? 'text-[11px]' : 'text-[15px]')} style={{ color: g.virtual ? '#b8bdcc' : g.hex }}>
        {g.name}
      </span>
      {g.host?.chip && (
        <span className={cx(auto, 'mt-1 flex w-max max-w-[260px] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 font-medium whitespace-nowrap', compact ? 'text-[10px]' : 'text-[11px]')} style={{ borderColor: `${g.hex}88`, color: '#dfe6ff', background: 'rgba(10,12,22,.72)' }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.hex }} /> {g.host.chip}
        </span>
      )}
      {yours && (
        <span className={cx(auto, 'mt-1 flex w-max items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium whitespace-nowrap', compact ? 'text-[10px]' : 'text-[11px]')} style={{ borderColor: `${g.hex}66`, color: '#c9d1e8', background: 'rgba(10,12,22,.6)' }}>
          Yours
        </span>
      )}
      {!compact && brief && g.changed > 0 && <ChangedPill n={g.changed} hook="data-galaxy-changed" className={cx(auto, 'mt-1 flex w-max')} />}
      {!compact && !brief && (
        <>
          <span className="tabular mt-0.5 block text-[12px] whitespace-nowrap text-muted [text-shadow:0_1px_8px_rgba(0,0,0,.9)]">
            {counts}
            {g.overdue > 0 && <span className="text-danger"> · {g.overdue} overdue</span>}
            {g.changed > 0 && (
              <span className="text-danger" data-galaxy-changed={g.changed}>
                {' · '}
                <NotEqual size={10} /> {changedText(g.changed)}
              </span>
            )}
          </span>
          {g.total > 0 && (
            <span className={cx(auto, 'mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-white/10')}>
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
  close = false,
  faded = false,
  clipped = false,
  away = false,
  dimmed,
  dragging,
  onPointerDown,
  onClick,
  portalTo,
  onPortal,
}: {
  s: SystemPlace;
  /** Beside the system in view: the star and its name are drawn faint (but still click through to it). */
  away?: boolean;
  /** Under the minimap or the zoom control: not drawn. */
  clipped?: boolean;
  /** A portal: the chip's words ("to Things"). */
  portalTo?: string;
  onPortal?: () => void;
  x: number;
  y: number;
  k: number;
  selected: boolean;
  current: boolean;
  /** Planets are drawn round it: counts go under its name, not on the star (where planets pass). */
  close?: boolean;
  /** Under the toolbar (a neighbour of the system in view): drawn faint. */
  faded?: boolean;
  dimmed: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const { project, stats } = s.pv;
  const changed = s.pv.changed.moons;
  const hex = colorHex(project.color);
  const rs = clamp(s.pv.radius * k, 9, 66);
  const ring = rs + 6;
  const C = 2 * Math.PI * ring;
  const pct = Math.round(stats.progress * 100);
  const showMeta = starShowsMeta(s.pv, k);
  const label = portalTo
    ? `${project.name}: a way ${portalTo}. ${current ? 'Open details.' : 'Fly to it.'}`
    : `${project.name}. ${stats.total || !s.pv.itemCount ? `${stats.open} open, ${stats.parked} parked, ${stats.done} done, ${pct}% complete.` : ''}${s.pv.itemCount ? ` ${s.pv.itemCount} items.` : ''}${stats.overdue ? ` ${stats.overdue} overdue.` : ''}${changed ? ` ${changedText(changed)}.` : ''} ${current ? 'Open details.' : 'Fly to this system.'}`;
  const box = ring * 2 + 8;
  if (portalTo) return <PortalNode s={s} x={x} y={y} rs={rs} label={label} chip={portalTo} selected={selected} current={current} faded={faded || clipped} dimmed={dimmed} dragging={dragging} onPointerDown={onPointerDown} onClick={onClick} onPortal={onPortal} />;
  return (
    <>
    <div className={cx('absolute', (faded || clipped) && 'pointer-events-none')} style={{ left: x, top: y, width: 0, height: 0, opacity: clipped ? 0 : away ? 0.3 : dimmed ? 0.3 : faded ? 0.35 : 1, zIndex: dragging ? 30 : selected ? 22 : 18 }}>
      {/* corona */}
      <span
        className="pointer-events-none absolute rounded-full"
        style={{ left: -rs * 2.6, top: -rs * 2.6, width: rs * 5.2, height: rs * 5.2, background: `radial-gradient(circle, ${hex}55 0%, ${hex}1f 32%, transparent 68%)` }}
        aria-hidden
      />
      <button
        aria-label={label}
        data-system={project.id}
        data-changed={changed || undefined}
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
        {rs >= 15 && !close && stats.overdue > 0 && (
          <span className="absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white ring-2 ring-[#0a0c12]" style={{ right: 0, top: 0 }} title={`${stats.overdue} overdue`}>
            {stats.overdue}
          </span>
        )}
        {!close && changed > 0 && !portalTo && <ChangedBadge n={changed} small={rs < 15} style={{ right: rs < 15 ? -4 : 0, bottom: rs < 15 ? -2 : 0 }} />}
        {rs >= 15 && !close && stats.parked > 0 && (
          <span className="absolute flex h-5 items-center gap-0.5 rounded-full bg-[#F5B544] px-1.5 text-[10.5px] font-bold text-[#2a1a00] ring-2 ring-[#0a0c12]" style={{ left: 0, top: 0 }} title={`${stats.parked} parked`}>
            <Pause size={9} strokeWidth={3} />
            {stats.parked}
          </span>
        )}
      </button>
    </div>
    {/* its name: above the planets (nothing is drawn over it), three lines at most; a name too long for that loses its middle, not its end */}
    <div
      className={cx('pointer-events-none absolute -translate-x-1/2 text-center', close && 'rounded-lg bg-[#05070f]/70 px-2 py-0.5 backdrop-blur-[2px]')}
      style={{ left: x, top: y + ring + 8, width: close ? 'max-content' : STAR_NAME_W, maxWidth: STAR_NAME_W, opacity: clipped ? 0 : away ? 0.3 : dimmed ? 0.3 : faded ? 0.35 : 1, zIndex: dragging ? 30 : 24 }}
    >
      <div title={project.name} className={cx('font-display leading-tight font-semibold [text-shadow:0_0_3px_#000,0_1px_10px_rgba(0,0,0,.95)]', rs >= 30 ? 'text-[15px]' : 'text-[13px]', current ? 'text-white' : 'text-text')}>
        {starNameLines(project.name, rs, measureLabel).map((l, i) => (
          <span key={i} className="block whitespace-nowrap">
            {l}
          </span>
        ))}
      </div>
      {showMeta && (
        <div className="tabular flex justify-center text-[11.5px] whitespace-nowrap text-muted [text-shadow:0_0_3px_#000,0_1px_8px_rgba(0,0,0,.95)]">
          <span className="min-w-0 truncate">
          {project.host?.code ? `${project.host.code} · ` : ''}
          {stats.total === 0
            ? s.pv.itemCount
              ? `${s.pv.itemCount} item${s.pv.itemCount === 1 ? '' : 's'}`
              : 'No tasks yet'
            : `${stats.open} open${stats.parked && !close ? ` · ${stats.parked} parked` : ''}${s.pv.itemCount ? ` · ${s.pv.itemCount} items` : ''} · ${pct}%`}
          {stats.openEffortMin > 0 && ` · ${fmtMinutes(stats.openEffortMin)} left`}
          {close && stats.parked > 0 && <span className="text-amber"> · {stats.parked} parked</span>}
          {close && stats.overdue > 0 && <span className="text-danger"> · {stats.overdue} overdue</span>}
          </span>
          {changed > 0 && (
            <span className="shrink-0 text-danger" data-system-changed={changed}>
              {'\u00a0· '}
              {changedText(changed)}
            </span>
          )}
        </div>
      )}
    </div>
    </>
  );
}

/** One arm of a portal's swirl (unit: the swirl is drawn in a 100×100 box around 0,0). */
const SWIRL = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const r = 7 + 37 * t;
    const a = t * 3.5;
    pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
  }
  return `M ${pts.join(' L ')}`;
})();

/** A system that leads to another verse: a violet swirl (not a star), its name, and a chip that goes through. */
function PortalNode({
  s,
  x,
  y,
  rs,
  label,
  chip,
  selected,
  current,
  faded,
  dimmed,
  dragging,
  onPointerDown,
  onClick,
  onPortal,
}: {
  s: SystemPlace;
  x: number;
  y: number;
  rs: number;
  label: string;
  chip: string;
  selected: boolean;
  current: boolean;
  faded: boolean;
  dimmed: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
  onPortal?: () => void;
}) {
  const gid = useId();
  const R = rs * 1.2;
  const box = R * 2 + 10;
  const opacity = dimmed ? 0.3 : faded ? 0.35 : 1;
  return (
    <>
      <div className={cx('absolute', faded && 'pointer-events-none')} style={{ left: x, top: y, width: 0, height: 0, opacity, zIndex: dragging ? 30 : selected ? 22 : 18 }}>
        <span className="pointer-events-none absolute rounded-full" style={{ left: -R * 2.2, top: -R * 2.2, width: R * 4.4, height: R * 4.4, background: 'radial-gradient(circle, rgba(177,140,255,.28) 0%, rgba(120,80,220,.10) 38%, transparent 68%)' }} aria-hidden />
        <button
          data-portal={s.pv.project.id}
          aria-label={label}
          title={`${s.pv.project.name} — ${current ? 'click for details' : 'click to fly in'}; its chip goes ${chip}`}
          onPointerDown={onPointerDown}
          onClick={onClick}
          className={cx('group absolute rounded-full outline-none focus-visible:ring-4 focus-visible:ring-accent/60', dragging ? 'cursor-grabbing' : 'cursor-pointer')}
          style={{ left: -box / 2, top: -box / 2, width: box, height: box, boxShadow: selected ? '0 0 0 3px #0a0c12, 0 0 0 5px #b18cff' : undefined }}
        >
          <svg viewBox="-50 -50 100 100" width={box} height={box} className="portal-swirl absolute inset-0 overflow-visible" aria-hidden>
            <defs>
              <radialGradient id={gid}>
                <stop offset="0" stopColor="#04020a" />
                <stop offset="0.5" stopColor="#2a1757" stopOpacity="0.9" />
                <stop offset="1" stopColor="#2a1757" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle r={47} fill={`url(#${gid})`} />
            {[0, 1, 2, 3].map((i) => (
              <path key={i} d={SWIRL} transform={`rotate(${i * 90})`} fill="none" stroke={i % 2 ? '#d9c8ff' : '#b18cff'} strokeOpacity={i % 2 ? 0.55 : 0.9} strokeWidth={i % 2 ? 1.6 : 2.6} strokeLinecap="round" />
            ))}
            <circle r={6.5} fill="#04020a" stroke="#efe6ff" strokeOpacity={0.75} strokeWidth={1.4} />
          </svg>
        </button>
      </div>
      <div className="pointer-events-none absolute flex -translate-x-1/2 flex-col items-center text-center" style={{ left: x, top: y + R + 10, width: STAR_NAME_W, opacity, zIndex: dragging ? 30 : 24 }}>
        <div className={cx('line-clamp-2 font-display leading-tight font-semibold break-words [text-shadow:0_0_3px_#000,0_1px_10px_rgba(0,0,0,.95)]', rs >= 30 ? 'text-[15px]' : 'text-[13px]', current ? 'text-white' : 'text-text')}>{s.pv.project.name}</div>
        <button
          data-portal-chip={s.pv.project.id}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onPortal}
          className="pointer-events-auto mt-1 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-[#b18cff]/70 bg-[#1a1130]/90 px-2.5 py-0.5 text-[12px] font-medium text-[#e6dbff] shadow-panel hover:bg-[#2a1a4d] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          title={`Go ${chip}, in the same galaxy`}
        >
          <WormholeMark size={13} className="shrink-0" /> <span className="truncate">{chip}</span>
        </button>
      </div>
    </>
  );
}

/** A record shown as a planet: its family's colour; hollow when archived, struck when gone, faint and dashed when a ghost. */
function ItemNode({
  iv,
  color,
  familyLabel,
  x,
  y,
  d,
  lightAngle,
  label,
  selected,
  dimmed,
  away = false,
  onClick,
  onHover,
}: {
  iv: ItemView;
  color: string;
  familyLabel: string;
  x: number;
  y: number;
  d: number;
  lightAngle: number;
  label?: OrbitLabel;
  selected: boolean;
  dimmed: boolean;
  /** Another system's planet while a system is entered: drawn faint, so it does not compete with the system in view. */
  away?: boolean;
  onClick: () => void;
  onHover?: (on: boolean) => void;
}) {
  const it = iv.item;
  const live = it.state === 'live' && !it.ghost;
  const gone = it.state === 'gone';
  // size 0, "nothing yet": the smallest diameter, a thin rim and a pale fill, so it never reads as "a little"
  const empty = it.size === 0 && live;
  const hx = 50 + Math.cos(lightAngle) * 24;
  const hy = 50 + Math.sin(lightAngle) * 24;
  const r = d / 2 + 5;
  const C = 2 * Math.PI * r;
  const desc = [
    it.title,
    it.sub,
    familyLabel,
    it.ghost ? 'lives elsewhere' : it.state !== 'live' ? it.state : null,
    it.size === 0 ? 'size 0, nothing yet' : null,
    it.ring != null ? `ring ${Math.round(it.ring * 100)}%` : null,
    it.moons.items.length + it.moons.more ? `${it.moons.items.length + it.moons.more} attached` : null,
    iv.changed > 0 ? changedText(iv.changed) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    // The pop animation ends at opacity 1 and holds it, so the faintness lives on an inner element.
    <div className="group/planet anim-pop absolute" data-item={it.id} data-changed={iv.changed > 0 ? iv.changed : undefined} style={{ left: x, top: y, width: 0, height: 0, zIndex: selected ? 26 : 20 }} onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}>
     <div className="absolute top-0 left-0" data-fade style={{ width: 0, height: 0, opacity: away && !selected ? AWAY_OPACITY : dimmed ? 0.22 : it.ghost ? 0.62 : 1 }}>
      {selected && <SelectedMark r={r + 9} />}
      <button onClick={onClick} onPointerDown={(e) => e.stopPropagation()} aria-label={`${desc}. Open details.`} title={desc} className="group absolute rounded-full outline-none" style={{ left: -r - 2, top: -r - 2, width: 2 * r + 4, height: 2 * r + 4 }}>
        {iv.changed > 0 && <ChangedRim d={d} n={iv.changed} />}
        {it.ring != null && (
          <svg className="absolute inset-0 -rotate-90 overflow-visible" width={2 * r + 4} height={2 * r + 4} aria-hidden>
            <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={2} />
            <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke="#eef2ff" strokeOpacity={0.85} strokeWidth={2} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - it.ring)} />
          </svg>
        )}
        <span
          className="absolute flex items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-accent/60"
          style={{
            left: r + 2 - d / 2,
            top: r + 2 - d / 2,
            width: d,
            height: d,
            background: empty
              ? `radial-gradient(circle at ${hx}% ${hy}%, rgba(255,255,255,.32) 0%, color-mix(in srgb, ${color} 34%, transparent) 55%, color-mix(in srgb, ${color} 16%, transparent) 100%)`
              : live
                ? `radial-gradient(circle at ${hx}% ${hy}%, rgba(255,255,255,.7) 0%, ${color} 36%, color-mix(in srgb, ${color} 42%, black) 100%)`
                : 'rgba(10,12,22,.85)',
            border: empty ? `1.2px solid color-mix(in srgb, ${color} 70%, transparent)` : live ? undefined : `${it.ghost ? 1.5 : 2.2}px ${it.ghost ? 'dashed' : 'solid'} ${color}`,
            boxShadow: selected ? '0 0 0 3px #0a0c12, 0 0 0 6px #a99bff, 0 0 26px 8px rgba(139,124,246,.7)' : undefined,
          }}
        >
          {gone && <span className="absolute h-[2px] rounded-full" style={{ width: d * 1.15, background: color, transform: 'rotate(-45deg)' }} />}
        </span>
        {it.ghost && (
          <span className="absolute flex items-center justify-center rounded-full bg-[#1a1130] text-[#e6dbff] ring-1 ring-[#b18cff]/80" style={{ right: -4, top: -4, width: 16, height: 16 }} title="Lives elsewhere: its panel shows the way home">
            <ArrowUpRight size={11} strokeWidth={2.6} />
          </span>
        )}
      </button>
      {label && (
        <div
          className={cx(
            'pointer-events-none absolute text-[11.5px] leading-[14px] whitespace-nowrap',
            label.side === 'right' ? 'text-left' : label.side === 'left' ? 'text-right' : 'text-center',
            gone ? 'text-faint line-through' : it.ghost ? 'text-muted italic' : 'text-text',
            !label.shown && 'hidden rounded-md bg-[#0b0e1a]/90 px-1.5 py-0.5 shadow-panel group-hover/planet:block',
            selected && 'font-semibold text-white',
          )}
          style={{ left: label.rect.x - x - (label.shown ? 0 : 6), top: label.rect.y - y - (label.shown ? 0 : 2), width: label.rect.w + (label.shown ? 0 : 12), zIndex: 2 }}
        >
          {label.lines.map((l, i) => (
            <span key={i} className="block [text-shadow:0_0_3px_#000,0_1px_8px_rgba(0,0,0,.95)]">
              {l}
            </span>
          ))}
          {label.pill && <ChangedPill n={iv.changed} className="mt-px" />}
        </div>
      )}
     </div>
    </div>
  );
}

/** Planets and names of the systems beside the one in view. */
const AWAY_OPACITY = 0.14;

const PRIORITY_MIX = { 1: 40, 2: 66, 3: 88, 4: 100 } as const;

function PlanetNode({
  tv,
  color,
  x,
  y,
  d,
  lightAngle,
  today,
  label,
  selected,
  dimmed,
  away = false,
  onClick,
  onHover,
}: {
  away?: boolean;
  onHover?: (on: boolean) => void;
  tv: TaskView;
  color: string;
  x: number;
  y: number;
  d: number;
  lightAngle: number;
  today: string;
  /** Where its name goes; hidden ones show on hover. */
  label?: OrbitLabel;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const { task, active, blocked, progress } = tv;
  const done = task.status === 'done';
  const dropped = !!task.host?.dropped;
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
    active ? 'in focus now' : dropped ? 'dropped' : done ? 'done' : parked ? 'parked' : blocked ? 'waiting on another task' : null,
    `${PRIORITY_META[task.priority].label} priority`,
    task.estimateMin ? `about ${fmtMinutes(task.estimateMin)}` : null,
    task.due && !done ? describeDue(task.due, today).label : null,
    progress > 0 && !done ? `${progress}% done` : null,
    tv.changed > 0 && !done ? changedText(tv.changed) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const atmosphere = overdue ? '#f2766b' : soon ? '#f5b544' : null;
  const style: CSSProperties = { left: x, top: y, width: 0, height: 0, zIndex: selected ? 26 : 20 };
  return (
    // opacity on an inner element: the pop animation holds opacity 1 and would override it here
    <div className="group/planet anim-pop absolute" data-task={task.id} data-changed={tv.changed > 0 && !done ? tv.changed : undefined} style={style} onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}>
     <div className="absolute top-0 left-0" data-fade style={{ width: 0, height: 0, opacity: away && !selected ? AWAY_OPACITY : dimmed ? 0.22 : done ? 0.6 : 1 }}>
      {selected && <SelectedMark r={r + 9} />}
      <button onClick={onClick} onPointerDown={(e) => e.stopPropagation()} aria-label={desc} title={desc} className="group absolute rounded-full outline-none" style={{ left: -r - 2, top: -r - 2, width: 2 * r + 4, height: 2 * r + 4 }}>
        {overdue && <span className="anim-pulse absolute rounded-full" style={{ inset: 3, boxShadow: '0 0 0 2px #f2766b, 0 0 14px 2px rgba(242,118,107,.55)' }} />}
        {tv.changed > 0 && !done && <ChangedRim d={d} n={tv.changed} />}
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
            boxShadow: [atmosphere && !overdue ? `0 0 0 2px ${atmosphere}, 0 0 12px 2px ${atmosphere}88` : '', active ? '0 0 0 3px #2dd4bf, 0 0 22px 4px rgba(45,212,191,.65)' : '', selected ? '0 0 0 3px #0a0c12, 0 0 0 6px #a99bff, 0 0 26px 8px rgba(139,124,246,.7)' : '']
              .filter(Boolean)
              .join(', ') || undefined,
          }}
        >
          {active ? (
            <span className="anim-pulse h-2.5 w-2.5 rounded-full bg-[#2dd4bf] shadow-[0_0_8px_#2dd4bf]" />
          ) : dropped ? (
            <X size={Math.max(11, d * 0.4)} strokeWidth={3} className="drop-shadow" />
          ) : done ? (
            <Check size={Math.max(11, d * 0.4)} strokeWidth={3} className="drop-shadow" />
          ) : parked ? (
            <Pause size={Math.max(10, d * 0.36)} strokeWidth={2.8} className="drop-shadow" />
          ) : blocked ? (
            <Lock size={Math.max(10, d * 0.32)} strokeWidth={2.4} className="drop-shadow" />
          ) : null}
        </span>
      </button>
      {label && (
        <div
          className={cx(
            'pointer-events-none absolute text-[11.5px] leading-[14px] whitespace-nowrap',
            label.side === 'right' ? 'text-left' : label.side === 'left' ? 'text-right' : 'text-center',
            done ? 'text-faint line-through' : 'text-text',
            // hidden names show on hover, on a backing so they read over whatever is there
            !label.shown && 'hidden rounded-md bg-[#0b0e1a]/90 px-1.5 py-0.5 shadow-panel group-hover/planet:block',
            selected && 'font-semibold text-white',
          )}
          style={{ left: label.rect.x - x - (label.shown ? 0 : 6), top: label.rect.y - y - (label.shown ? 0 : 2), width: label.rect.w + (label.shown ? 0 : 12), zIndex: 2 }}
        >
          {label.lines.map((l, i) => (
            <span key={i} className="block [text-shadow:0_0_3px_#000,0_1px_8px_rgba(0,0,0,.95)]">
              {l}
            </span>
          ))}
          {label.pill && <ChangedPill n={tv.changed} className="mt-px" />}
        </div>
      )}
     </div>
    </div>
  );
}

/** The selected planet: four brackets around it, so it is unmistakable at any zoom. */
function SelectedMark({ r }: { r: number }) {
  const s = r * 2;
  const a = Math.max(6, r * 0.45);
  const p = (x: number, y: number, dx: number, dy: number) => `M ${x + dx * a} ${y} L ${x} ${y} L ${x} ${y + dy * a}`;
  return (
    <svg className="pointer-events-none absolute overflow-visible" style={{ left: -r, top: -r }} width={s} height={s} aria-hidden>
      <path d={[p(0, 0, 1, 1), p(s, 0, -1, 1), p(0, s, 1, -1), p(s, s, -1, -1)].join(' ')} fill="none" stroke="#c4b9ff" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
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

function FiltersButton({ hosted = false, hasFinished = false, compact = false }: { hosted?: boolean; hasFinished?: boolean; compact?: boolean }) {
  const filter = useOrbit((s) => s.filter);
  const setFilter = useOrbit((s) => s.setFilter);
  const attachments = useOrbit((s) => s.host?.attachments);
  const families = useOrbit((s) => s.host?.families);
  // everything any task uses, once each, for "Uses …"
  const usable = useMemo(() => {
    const m = new Map<string, { id: string; label: string; family: string }>();
    for (const set of Object.values(attachments ?? {})) for (const a of set.items) if (!m.has(a.id)) m.set(a.id, { id: a.id, label: a.label, family: a.family });
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [attachments]);
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
  type Toggle = 'dueSoon' | 'highPriority' | 'parkedOnly' | 'showDone' | 'hasLinked' | 'hasChanged' | 'showFinished';
  const rows: [Toggle, string, string][] = [
    ['dueSoon', 'Due soon', 'Overdue or due within 3 days'],
    ['highPriority', 'High priority', 'High and critical only'],
    ...(hosted ? [] : ([['parkedOnly', 'Parked', 'Only tasks with saved context']] as [Toggle, string, string][])),
    ...(hosted ? ([['hasLinked', 'Has linked items', 'Only tasks that use or hold something (moons)']] as [Toggle, string, string][]) : []),
    ...(hosted ? ([['hasChanged', 'Has something changed', 'Highlight planets with a moon that changed since it was attached']] as [Toggle, string, string][]) : []),
    ['showDone', 'Show done', 'Include completed tasks'],
    ...(hosted && hasFinished ? ([['showFinished', 'Show finished', 'Include galaxies marked finished']] as [Toggle, string, string][]) : []),
  ];
  const count = rows.filter(([k]) => k !== 'showDone' && k !== 'showFinished' && filter[k]).length + (filter.uses ? 1 : 0);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Filters${count ? `, ${count} on` : ''}`}
        title="Filters"
        className={cx('inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium shadow-panel backdrop-blur-xl', count ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface/80 text-muted hover:text-text')}
      >
        <SlidersHorizontal size={15} /> {!compact && <span className="hidden xl:inline">Filters</span>}
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
          {hosted && usable.length > 0 && (
            <label className="mt-1 block border-t border-line px-2.5 pt-2.5 pb-1.5">
              <span className="block text-sm font-medium">Uses…</span>
              <span className="mb-1.5 block text-xs text-muted">Highlight every task that uses one thing</span>
              <select
                value={filter.uses ?? ''}
                onChange={(e) => setFilter({ uses: e.target.value || null })}
                aria-label="Highlight tasks that use"
                className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-sm text-text outline-none focus:border-accent"
              >
                <option value="">Anything</option>
                {usable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                    {families?.[u.family] ? ` — ${families[u.family].label}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** The minimap grows with a wide canvas. */
function minimapSize(w: number) {
  const W = w >= 1700 ? 248 : w >= 1400 ? 212 : 176;
  return { w: W, h: Math.round(W * 0.64) };
}

function Minimap({ galaxies, view, size, W, H, onFly, onPan }: { galaxies: GalaxyPlace[]; view: View; size: Size; W: number; H: number; onFly: (t: Target) => void; onPan: (v: View) => void }) {
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

/**
 * `recordsOnly`: a verse that is not editable (and not the work verse) shows records, never tasks, so only what is true
 * for records is listed; the verse's own sentence says what size, colour and ring mean there.
 */
function Legend({ onClose, hosted = false, hostName = '', verseLegend, recordsOnly = false }: { onClose: () => void; hosted?: boolean; hostName?: string; verseLegend?: string; recordsOnly?: boolean }) {
  const Row = ({ icon, children, hook }: { icon: React.ReactNode; children: React.ReactNode; hook?: string }) => (
    <li className="flex items-center gap-3" data-legend-row={hook}>
      <span className="flex w-8 shrink-0 justify-center">{icon}</span>
      <span>{children}</span>
    </li>
  );
  const hostRows = (
    <>
      <Row icon={<span className="h-5 w-5 rounded-full border border-dashed border-white/60" />}>Dashed ring with ticks: a galaxy kept by {hostName}. Its chip says what it is.</Row>
      {!recordsOnly && <Row icon={<span className="h-5 w-5 rounded-full border border-white/60" />}>Thin solid rim, “Yours” chip: a galaxy of your own, kept with ORBIT.</Row>}
      <Row icon={<span className="flex gap-0.5"><span className="h-2 w-2 rounded-full bg-[#f5b544]" /><span className="h-2 w-2 rounded-full border border-[#4fa3f0]" /></span>}>
        {recordsOnly ? 'Moons: what a record holds or refers to.' : 'Moons: what a task uses.'} Hollow: archived; struck: gone; red: changed since.
      </Row>
      <Row icon={<span className="flex items-center gap-1.5"><span className="relative h-4 w-4 rounded-full bg-white/25"><span className="absolute -inset-[3px] rounded-full border-[3px] border-transparent border-t-[#f2766b]" /></span><span className="inline-flex h-4 items-center gap-0.5 rounded-[5px] border-[1.5px] border-danger bg-[#1b0d11] px-0.5 text-danger"><NotEqual size={9} /></span></span>} hook="changed">
        Red notch on a planet, red “≠” tag on a star: something it holds changed since it was attached. Not the same as overdue (a whole red glow, a round badge). The sky adds up how many are inside each system and galaxy.
      </Row>
      <Row icon={<span className="h-3 w-5 rounded-full border-y-2 border-dotted border-white/50" />}>{recordsOnly ? 'Belt: what a system holds that nothing here uses.' : 'Belt: what a system holds that no task uses.'} Many: a haze with a count.</Row>
      <Row icon={<span className="h-2.5 w-2.5 rotate-45 border-[1.6px] border-white" />}>Diamond: a date. White planned, amber soon, red late, teal achieved, grey rescoped.</Row>
      <Row icon={<span className="flex gap-1"><span className="h-4 w-4 rounded-full bg-[#5ad1c8]" /><span className="h-4 w-4 rounded-full border-2 border-[#5ad1c8]" /></span>}>
        {recordsOnly ? 'Planet: a record, coloured by its kind.' : 'Coloured by kind: a record, not a task.'} Hollow: archived; struck: gone; dashed and faint: lives elsewhere.
      </Row>
      {recordsOnly && <Row icon={<span className="h-3.5 w-3.5 rounded-full border border-white/50 bg-white/15" />}>Smallest, thin and pale: size 0, nothing yet. Any size above 0 is a little larger and solid.</Row>}
      {recordsOnly && <Row icon={<span className="h-5 w-5 rounded-full border-2 border-white/10" style={{ borderTopColor: 'rgba(255,255,255,.85)', borderRightColor: 'rgba(255,255,255,.85)' }} />}>White ring: a share, as the line above says.</Row>}
      <Row icon={<span className="h-0.5 w-6 rounded bg-[#8fd8ff]" />}>Thin blue arrow: a relation between two records (e.g. “made from”), drawn from the first to the second. Never a block.</Row>
      <Row icon={<WormholeMark size={18} className="text-[#c9b3ff]" />}>Violet swirl: a portal or a wormhole to the same thing in another view.</Row>
    </>
  );
  return (
    <div data-ui className="anim-pop absolute top-12 right-0 z-30 w-[340px] rounded-2xl border border-line-strong bg-raised p-4 text-[13px] leading-snug shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold">Reading the universe</h3>
        <IconButton label="Close" size="xs" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {verseLegend && <p className="mb-3 rounded-xl border border-[#b18cff]/40 bg-[#b18cff]/10 px-3 py-2 text-[12.5px] text-text">In this view: {verseLegend}</p>}
      {recordsOnly ? (
        <ul className="space-y-2.5 text-muted" data-legend="records">
          <Row icon={<span className="h-5 w-5 rounded-full bg-[radial-gradient(circle,#fff_0%,#8b7cf6_35%,transparent_70%)]" />}>Galaxy: a group of systems.</Row>
          <Row icon={<span className="h-5 w-5 rounded-full border-[3px] border-accent bg-[radial-gradient(circle_at_40%_36%,#fff,#8b7cf6)]" style={{ borderRightColor: 'rgba(255,255,255,.15)', borderBottomColor: 'rgba(255,255,255,.15)' }} />}>
            Star: a system holding records. Bigger star = more records; its label says how many.
          </Row>
          {hostRows}
        </ul>
      ) : (
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
          {hosted && hostRows}
        </ul>
      )}
      <p className="mt-3 border-t border-line pt-3 text-xs text-faint">
        Click a galaxy or star to fly in · Esc goes up · [ ] previous / next · 0 whole universe · double-click to zoom · drag stars to rearrange, or onto another galaxy to move them · drag a galaxy’s name to move the galaxy.
      </p>
    </div>
  );
}

/** The three switches for what a host adds to the sky; kept in preferences. */
function LayerSwitches({ compact = false }: { compact?: boolean }) {
  const layers = useOrbit((s) => s.prefs.layers);
  const setPrefs = useOrbit((s) => s.setPrefs);
  const items: [keyof typeof layers, string, string, React.ReactNode][] = [
    ['moons', 'Moons', 'What each task uses or holds', <Moon key="m" size={15} />],
    ['belts', 'Belts', 'What a system holds that no task uses', <CircleDashed key="b" size={15} />],
    ['beacons', 'Dates', 'Dates that matter, on galaxies and beside systems', <Diamond key="d" size={14} />],
  ];
  return (
    <div role="group" aria-label="Layers" className="flex h-10 items-center gap-0.5 rounded-xl border border-line bg-surface/80 px-1 shadow-panel backdrop-blur-xl">
      {items.map(([key, label, title, icon]) => (
        <button
          key={key}
          title={compact ? `${label}: ${title}` : title}
          aria-label={label}
          aria-pressed={layers[key]}
          onClick={() => setPrefs({ layers: { ...layers, [key]: !layers[key] } })}
          className={cx(
            'flex h-8 items-center justify-center rounded-lg text-xs font-medium transition-colors',
            compact ? 'w-8' : 'px-2.5',
            layers[key] ? 'bg-accent-soft text-text' : cx('text-faint hover:text-text', !compact && 'line-through decoration-faint/60'),
          )}
        >
          {compact ? icon : label}
        </button>
      ))}
    </div>
  );
}

/** The selected planet's moons, named beside it. Each opens its page in the host. */
function MoonChips({
  set,
  families,
  x,
  top,
  off,
  left,
  maxW,
  hostName,
  lead,
  leadFrom = 0,
}: {
  set: MoonSet;
  families: Record<string, Family>;
  x: number;
  top: number;
  off: number;
  left: boolean;
  maxW: number;
  hostName: string;
  /** A faint line from the planet to the list, when the list sits away from it. */
  lead?: { from: { x: number; y: number }; to: { x: number; y: number } };
  /** The line starts this far from the planet's centre (its edge). */
  leadFrom?: number;
}) {
  const openInHost = useOrbit((s) => s.openInHost);
  const follow = useOrbit((s) => s.followWormhole);
  const verses = useOfferedVerses();
  const onScreen = useOrbit((s) => s.host?.shown);
  const shown = set.items.slice(0, 8);
  const rest = set.items.length - shown.length + set.more;
  return (
    <>
    {lead && (
      <svg className="pointer-events-none absolute inset-0 z-[39] h-full w-full overflow-visible" aria-hidden>
        {(() => {
          const a = Math.atan2(lead.to.y - lead.from.y, lead.to.x - lead.from.x);
          const x1 = lead.from.x + Math.cos(a) * leadFrom;
          const y1 = lead.from.y + Math.sin(a) * leadFrom;
          return (
            <>
              <line x1={x1} y1={y1} x2={lead.to.x} y2={lead.to.y} stroke="#c4b9ff" strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="3 4" />
              <circle cx={x1} cy={y1} r={2.5} fill="#c4b9ff" fillOpacity={0.85} />
            </>
          );
        })()}
      </svg>
    )}
    <div
      data-ui
      role="list"
      aria-label="What this task uses"
      className="absolute z-40 flex flex-col gap-1"
      style={{ top, ...(left ? { right: `calc(100% - ${x - off}px)`, alignItems: 'flex-end' } : { left: x + off }) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {shown.map((m) => {
        const hex = m.flag === 'changed' ? '#f2766b' : (families[m.family]?.color ?? '#c9d2ee');
        const holes = (m.also ?? []).filter((a: Also) => verses.has(a.verse));
        return (
          <div key={m.id} role="listitem" className={cx('flex min-w-0 items-center gap-1', left && 'flex-row-reverse')} style={{ maxWidth: maxW }}>
            <button
              disabled={!m.open}
              onClick={() => openInHost(m.open)}
              title={m.open ? `Open in ${hostName}` : undefined}
              className="flex min-w-0 items-center gap-2 rounded-full border bg-[#0e111e]/95 py-1 pr-3 pl-2 text-left text-[11.5px] whitespace-nowrap text-text shadow-panel enabled:hover:bg-[#1a1f33] disabled:cursor-default"
              style={{ borderColor: `${hex}88` }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={m.state === 'live' ? { background: hex } : { boxShadow: `inset 0 0 0 1.5px ${hex}` }} />
              <span className={cx('truncate', m.state === 'gone' && 'text-faint line-through')}>{m.label}</span>
              {maxW >= 200 && <span className={cx('shrink-0', m.flag === 'changed' ? 'font-semibold text-danger' : 'text-faint')}>{m.flag === 'changed' ? 'changed since' : m.state !== 'live' ? m.state : (families[m.family]?.label ?? m.kind)}</span>}
              {m.open && <ExternalLink size={11} className="shrink-0 text-faint" />}
            </button>
            {holes.length > 0 && (
              <Menu
                label={`${m.label} elsewhere`}
                align={left ? 'right' : 'left'}
                trigger={(p) => (
                  <button {...p} aria-label={`${m.label}: wormholes`} title="The same thing in another view" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#b18cff]/70 bg-[#1a1130]/95 text-[#e6dbff] shadow-panel hover:bg-[#2a1a4d]">
                    <WormholeMark size={13} />
                  </button>
                )}
                items={holes.map((a: Also) => {
                  const t = wormholeText(a, verses, onScreen);
                  return { label: `${t.head}${t.note ? ` — ${t.note}` : t.plain && !t.here ? ` — ${t.plain}` : ''}`, icon: <WormholeMark size={13} />, onSelect: () => void follow(a) };
                })}
              />
            )}
          </div>
        );
      })}
      {rest > 0 && (
        <span className="rounded-xl bg-[#0e111e]/90 px-2.5 py-0.5 text-[12px] font-medium text-text" style={{ maxWidth: maxW }}>
          +{rest} more in {hostName}
        </span>
      )}
    </div>
    </>
  );
}
