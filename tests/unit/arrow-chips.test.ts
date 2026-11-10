import { describe, expect, it } from 'vitest';
import { CHIP, chipTitle, placeArrowChips, type ArrowCurve, type Spot } from '../../src/components/universe/arrows';
import type { Rect } from '../../src/components/universe/labels';

const measure = (t: string) => t.length * 6;
const curve = (ax: number, ay: number, bx: number, by: number, cx = (ax + bx) / 2, cy = (ay + by) / 2): ArrowCurve => ({ from: 'a', to: 'b', label: 'made from', ax, ay, bx, by, cx, cy });
const hitRect = (r: Rect, s: Spot) => {
  const nx = Math.max(r.x, Math.min(s.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(s.y, r.y + r.h));
  return Math.hypot(nx - s.x, ny - s.y) < s.r;
};

describe('the arrow chip: names and place', () => {
  it('keeps the first segment of a name, cut at a word with an ellipsis, never in the middle of one', () => {
    expect(chipTitle('Soil test notes · pH 6.4 in bed two', 400, measure)).toBe('Soil test notes');
    const t = chipTitle('Planting plan for the long raised beds · half built', 100, measure);
    expect(t.endsWith('…')).toBe(true);
    expect(measure(t)).toBeLessThanOrEqual(100);
    // the kept words are whole words of the title
    const kept = t.slice(0, -1).trim().split(' ');
    expect('Planting plan for the long raised beds'.split(' ').slice(0, kept.length)).toEqual(kept);
    // a name with no sub-line that fits is left alone
    expect(chipTitle('Pond liner', 100, measure)).toBe('Pond liner');
  });

  it('is never wider than its maximum, whatever the names', () => {
    const long = 'An extraordinarily long name that goes on and on and on · and a sub-line';
    const [c] = placeArrowChips([{ from: 'a', to: 'b', fromTitle: long, toTitle: long, label: 'made from', curve: curve(100, 300, 700, 300) }], { measure, disks: new Map() });
    expect(c.w).toBeLessThanOrEqual(CHIP.maxW);
    expect(c.fromText.endsWith('…') && c.toText.endsWith('…')).toBe(true);
    expect(c.full).toContain('and a sub-line');
  });

  it('sits on its curve when nothing is in the way, and hides no name', () => {
    const [c] = placeArrowChips([{ from: 'a', to: 'b', fromTitle: 'Alpha', toTitle: 'Beta', label: 'made from', curve: curve(100, 300, 500, 300) }], { measure, disks: new Map() });
    expect(c.x).toBeCloseTo(300, 0);
    expect(c.y).toBeCloseTo(300, 0);
    expect(c.hides).toEqual([]);
  });

  it('keeps off every planet, and off a neighbouring planet’s name when there is room', () => {
    const disks = new Map<string, Spot>([
      ['m', { x: 300, y: 300, r: 20, galaxy: 'g' }],
    ]);
    const labels = new Map([['m', { shown: true, rect: { x: 324, y: 292, w: 90, h: 14 } }]]);
    const [c] = placeArrowChips([{ from: 'a', to: 'b', fromTitle: 'Alpha', toTitle: 'Beta', label: 'made from', curve: curve(100, 300, 500, 300) }], { measure, disks, labels });
    const r = { x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h };
    expect(hitRect(r, disks.get('m')!)).toBe(false);
    expect(r.x < 324 + 90 && 324 < r.x + r.w && r.y < 306 && 292 < r.y + r.h).toBe(false);
    expect(c.hides).toEqual([]);
  });

  it('when there is no free place it hides the lower-priority name under it, never the arrow’s own', () => {
    // a corridor so narrow that the chip cannot avoid the two names near the middle of the curve
    const bounds: Rect = { x: 0, y: 285, w: 600, h: 30 };
    const labels = new Map([
      ['own', { shown: true, rect: { x: 250, y: 288, w: 100, h: 24 } }],
      ['other', { shown: true, rect: { x: 150, y: 288, w: 300, h: 24 } }],
    ]);
    const [c] = placeArrowChips([{ from: 'own', to: 'b', fromTitle: 'Alpha', toTitle: 'Beta', label: 'made from', curve: curve(100, 300, 500, 300) }], { measure, disks: new Map(), labels, bounds });
    expect(c.hides).toEqual(['other']);
    expect(c.hides).not.toContain('own');
  });

  it('two chips never sit on each other', () => {
    const [a, b] = placeArrowChips(
      [
        { from: 'a', to: 'b', fromTitle: 'Alpha', toTitle: 'Beta', label: 'made from', curve: curve(100, 300, 500, 300) },
        { from: 'c', to: 'd', fromTitle: 'Gamma', toTitle: 'Delta', label: 'made from', curve: curve(100, 302, 500, 302) },
      ],
      { measure, disks: new Map() },
    );
    const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
    expect(overlap).toBe(false);
  });
});
