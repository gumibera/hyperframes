export type FontMeta = {
  name: string;
  importName: string;
  category: "sans-serif" | "serif" | "monospace" | "display";
  weights: readonly number[];
  fontsourcePackage: string;
};

export const CANONICAL_FONTS: FontMeta[] = [
  {
    name: "Inter",
    importName: "inter",
    category: "sans-serif",
    weights: [400, 700, 900],
    fontsourcePackage: "@fontsource/inter",
  },
  {
    name: "Montserrat",
    importName: "montserrat",
    category: "sans-serif",
    weights: [400, 700, 900],
    fontsourcePackage: "@fontsource/montserrat",
  },
  {
    name: "Outfit",
    importName: "outfit",
    category: "sans-serif",
    weights: [400, 700, 900],
    fontsourcePackage: "@fontsource/outfit",
  },
  {
    name: "Nunito",
    importName: "nunito",
    category: "sans-serif",
    weights: [400, 700, 900],
    fontsourcePackage: "@fontsource/nunito",
  },
  {
    name: "Oswald",
    importName: "oswald",
    category: "display",
    weights: [400, 700],
    fontsourcePackage: "@fontsource/oswald",
  },
  {
    name: "League Gothic",
    importName: "league-gothic",
    category: "display",
    weights: [400],
    fontsourcePackage: "@fontsource/league-gothic",
  },
  {
    name: "Archivo Black",
    importName: "archivo-black",
    category: "display",
    weights: [400],
    fontsourcePackage: "@fontsource/archivo-black",
  },
  {
    name: "Space Mono",
    importName: "space-mono",
    category: "monospace",
    weights: [400, 700],
    fontsourcePackage: "@fontsource/space-mono",
  },
  {
    name: "IBM Plex Mono",
    importName: "ibm-plex-mono",
    category: "monospace",
    weights: [400, 700],
    fontsourcePackage: "@fontsource/ibm-plex-mono",
  },
  {
    name: "JetBrains Mono",
    importName: "jetbrains-mono",
    category: "monospace",
    weights: [400, 700],
    fontsourcePackage: "@fontsource/jetbrains-mono",
  },
  {
    name: "EB Garamond",
    importName: "eb-garamond",
    category: "serif",
    weights: [400, 700],
    fontsourcePackage: "@fontsource/eb-garamond",
  },
];

/**
 * Maps normalized font family names (lowercase) to canonical font import names.
 * Includes aliases for common system fonts that should be substituted.
 */
export const FONT_ALIASES: Record<string, string> = {
  inter: "inter",
  "helvetica neue": "inter",
  helvetica: "inter",
  arial: "inter",
  "helvetica bold": "inter",
  montserrat: "montserrat",
  futura: "montserrat",
  "din alternate": "montserrat",
  "arial black": "montserrat",
  outfit: "outfit",
  nunito: "nunito",
  oswald: "oswald",
  "bebas neue": "league-gothic",
  "league gothic": "league-gothic",
  "archivo black": "archivo-black",
  "space mono": "space-mono",
  "ibm plex mono": "ibm-plex-mono",
  "jetbrains mono": "jetbrains-mono",
  "courier new": "jetbrains-mono",
  courier: "jetbrains-mono",
  "eb garamond": "eb-garamond",
  garamond: "eb-garamond",
};

/**
 * CSS generic family keywords that should not be resolved to a specific font.
 */
export const GENERIC_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "emoji",
  "math",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
]);
