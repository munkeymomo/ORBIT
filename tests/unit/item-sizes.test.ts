import { describe, expect, it } from 'vitest';
import { adaptVerse, itemDiameter, itemDiameters, ITEM_DIAMETER } from '../../src/host/adapt';
import type { Planet, Verse } from '../../src/host/types';

const gaps = (d: number[]) => d.slice(1).map((x, i) => x - d[i]);

describe('item planet sizes: small whole numbers stay apart', () => {
  it('sizes 1, 2 and 3 beside a verse-wide 300 differ by at least 5 world units each (the old √ mapping gave 28, 29, 29)', () => {
    expect([1, 2, 3].map((z) => itemDiameter(z, 300))).toEqual([28, 29, 29]);
    const d = itemDiameters([1, 2, 3], 300);
    expect(d).toEqual([28, 33, 38]);
    for (const g of gaps(d)) expect(g).toBeGreaterThanOrEqual(ITEM_DIAMETER.step);
    // whatever the order they were sent in
    expect(itemDiameters([3, 1, 2], 300)).toEqual([38, 28, 33]);
  });

  it('leaves a system alone when its sizes are already well apart, and keeps equal sizes equal', () => {
    expect(itemDiameters([4, 9, 16], 16)).toEqual([4, 9, 16].map((z) => itemDiameter(z, 16)));
    const d = itemDiameters([2, 2, 3], 300);
    expect(d[0]).toBe(d[1]);
    expect(d[2] - d[0]).toBeGreaterThanOrEqual(ITEM_DIAMETER.step);
  });

  it('keeps 0 as "nothing yet" (the smallest of all), an unsized item at the default, and everything inside 26–60', () => {
    const d = itemDiameters([0, 1, 2, 3, undefined, 300], 300);
    expect(d[0]).toBe(ITEM_DIAMETER.zero);
    expect(d[0]).toBeLessThan(Math.min(...d.slice(1)));
    expect(d[4]).toBe(ITEM_DIAMETER.default);
    for (const x of d.slice(1)) {
      expect(x).toBeGreaterThanOrEqual(ITEM_DIAMETER.min);
      expect(x).toBeLessThanOrEqual(ITEM_DIAMETER.max);
    }
    // the biggest is still the biggest, 300 stays at the top of the range
    expect(d[5]).toBe(ITEM_DIAMETER.max);
  });

  it('order is kept near the top of the range, where the step has to push the smaller ones down, not the biggest up', () => {
    const d = itemDiameters([280, 290, 295, 300], 300);
    expect(Math.max(...d)).toBe(ITEM_DIAMETER.max);
    for (const g of gaps(d)) expect(g).toBeGreaterThanOrEqual(ITEM_DIAMETER.step);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });

  it('with more than seven distinct sizes the step is as many whole units as the range allows, and never zero up to 35', () => {
    const sizes = Array.from({ length: 12 }, (_, i) => i + 1);
    const d = itemDiameters(sizes, 5000);
    for (const g of gaps(d)) expect(g).toBeGreaterThanOrEqual(Math.floor((ITEM_DIAMETER.max - ITEM_DIAMETER.min) / 11));
    expect(Math.min(...d)).toBeGreaterThanOrEqual(ITEM_DIAMETER.min);
    expect(Math.max(...d)).toBeLessThanOrEqual(ITEM_DIAMETER.max);
    const many = itemDiameters(Array.from({ length: 35 }, (_, i) => i + 1), 5000);
    for (const g of gaps(many)) expect(g).toBeGreaterThanOrEqual(1);
  });

  it('adaptVerse spreads each system on its own: 1, 2, 3 in one system, a 300 in another', () => {
    const it = (id: string, system: string, size: number): Planet => ({ id, system, type: 'item', title: id, size });
    const v = {
      verse: 'v',
      rev: '1',
      galaxies: [{ id: 'g', name: 'G' }],
      systems: [
        { id: 'a', galaxy: 'g', name: 'A' },
        { id: 'b', galaxy: 'g', name: 'B' },
      ],
      planets: [it('a1', 'a', 1), it('a2', 'a', 2), it('a3', 'a', 3), it('b1', 'b', 300), it('b0', 'b', 0)],
    } as Verse;
    const a = adaptVerse(v, []);
    const dia = (sys: string) => a.extras.items[sys].map((x) => x.diameter);
    expect(dia('a')).toEqual([28, 33, 38]);
    expect(dia('b')).toEqual([ITEM_DIAMETER.max, ITEM_DIAMETER.zero]);
  });
});
