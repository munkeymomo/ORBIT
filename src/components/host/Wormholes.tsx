import { ArrowUpRight } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { Also, VerseInfo } from '../../host/types';
import { offeredVerses } from '../../host/verses';
import { SectionTitle, cx } from '../ui/primitives';

/** A wormhole: the same record (or galaxy) in another verse. The mark is a small swirl, the same everywhere. */
export function WormholeMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M8 8m-1.2 0a1.2 1.2 0 1 0 2.4 0a3 3 0 1 0-6 0a4.8 4.8 0 1 0 9.6 0a6.4 6.4 0 1 0-12.8 0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/** The verses the host offers now, by id. */
export function useOfferedVerses(): Map<string, VerseInfo> {
  const info = useOrbit((s) => s.host?.info);
  return new Map((info ? offeredVerses(info) : []).map((v) => [v.id, v]));
}

/** What a wormhole row says: the target verse's name and plain word, and the host's note. */
export function wormholeText(a: Also, verses: Map<string, VerseInfo>, shown?: string) {
  const v = verses.get(a.verse);
  const name = v?.name ?? a.verse;
  // a wormhole into the verse already on screen is a way to the record's home, not a change of view
  const here = shown != null && a.verse === shown;
  return { name, plain: v?.plain ?? '', note: a.note ?? '', offered: !!v, here, head: here ? 'Go to where it lives' : name };
}

/** "Wormholes": one row per `also` entry; a row flies to the same record in that verse. */
export function Wormholes({ also, title = 'Wormholes' }: { also?: Also[]; title?: string }) {
  const verses = useOfferedVerses();
  const shown = useOrbit((s) => s.host?.shown);
  const follow = useOrbit((s) => s.followWormhole);
  const list = (also ?? []).filter((a) => a && typeof a.verse === 'string');
  if (!list.length) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ul className="space-y-1">
        {list.map((a, i) => {
          const t = wormholeText(a, verses, shown);
          const here = t.here;
          return (
            <li key={`${a.verse}-${a.object ?? a.system ?? a.galaxy ?? ''}-${i}`}>
              <button
                disabled={!t.offered}
                onClick={() => void follow(a)}
                title={t.offered ? (here ? `Go to where it lives${a.note ? `: ${a.note}` : ''}` : `Go to ${t.name}${a.note ? `: ${a.note}` : ''}`) : `${t.name} is not offered now`}
                className={cx('flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left enabled:hover:border-[#b18cff]/60 enabled:hover:bg-surface-2 disabled:opacity-50')}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#b18cff]/15 text-[#c9b3ff]">
                  <WormholeMark size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {t.head}
                    {t.plain && !here && <span className="ml-1.5 text-xs font-normal text-muted">{t.plain}</span>}
                  </span>
                  {t.note && <span className="block truncate text-xs text-muted">{t.note}</span>}
                </span>
                <ArrowUpRight size={15} className="shrink-0 text-faint" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
