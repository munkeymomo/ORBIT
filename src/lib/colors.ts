/** Project colours chosen to read on both dark and light surfaces. */
export const PROJECT_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'violet', name: 'Violet', hex: '#8B7CF6' },
  { id: 'teal', name: 'Teal', hex: '#2CC5B2' },
  { id: 'amber', name: 'Amber', hex: '#F0A93B' },
  { id: 'coral', name: 'Coral', hex: '#EE6F64' },
  { id: 'sky', name: 'Sky', hex: '#4FA3F0' },
  { id: 'lime', name: 'Lime', hex: '#8CC94F' },
  { id: 'rose', name: 'Rose', hex: '#E46FAE' },
  { id: 'indigo', name: 'Indigo', hex: '#6375F0' },
  { id: 'mint', name: 'Mint', hex: '#43D29B' },
  { id: 'sand', name: 'Sand', hex: '#C9A574' },
];

export function colorHex(id: string): string {
  return PROJECT_COLORS.find((c) => c.id === id)?.hex ?? (id.startsWith('#') ? id : '#8B7CF6');
}

/** Picks dark or light ink for text drawn on top of a colour fill. */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.36 ? '#0B0D14' : '#FFFFFF';
}

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${h.slice(0, 6)}${a}`;
}

export function nextUnusedColor(used: string[]): string {
  const free = PROJECT_COLORS.find((c) => !used.includes(c.id));
  return (free ?? PROJECT_COLORS[used.length % PROJECT_COLORS.length]).id;
}
