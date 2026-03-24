import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'JetBrains Mono',
  importName: 'jetbrains-mono',
  category: 'monospace',
  weights: [400, 700] as const,
});

export const fontFamily = 'JetBrains Mono' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
