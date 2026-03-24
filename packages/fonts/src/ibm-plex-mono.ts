import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'IBM Plex Mono',
  importName: 'ibm-plex-mono',
  category: 'monospace',
  weights: [400, 700] as const,
});

export const fontFamily = 'IBM Plex Mono' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
