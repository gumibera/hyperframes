export type TemplateId =
  | "hf-dark"
  | "hf-gradient"
  | "16-bit"
  | "editorial"
  | "blank"
  | "warm-grain"
  | "play-mode"
  | "swiss-grid"
  | "vignelli"
  | "decision-tree"
  | "kinetic-type"
  | "product-promo"
  | "nyt-graph";

export interface TemplateOption {
  id: TemplateId;
  label: string;
  hint: string;
}

export const TEMPLATES: TemplateOption[] = [
  { id: "hf-dark", label: "Midnight", hint: "Dark tech with neon grid and glow accents" },
  { id: "hf-gradient", label: "Aurora", hint: "Shifting gradient backdrop with bold kinetic type" },
  { id: "16-bit", label: "16-Bit", hint: "Retro SNES pixel art with parallax and CRT effects" },
  {
    id: "editorial",
    label: "Editorial",
    hint: "Clean print-magazine serif with editorial red accent",
  },
  { id: "blank", label: "Blank", hint: "Empty composition — just the scaffolding" },
  { id: "warm-grain", label: "Warm Grain", hint: "Cream aesthetic with grain texture" },
  { id: "play-mode", label: "Play Mode", hint: "Playful elastic animations" },
  { id: "swiss-grid", label: "Swiss Grid", hint: "Structured grid layout" },
  { id: "vignelli", label: "Vignelli", hint: "Bold typography with red accents" },
  { id: "decision-tree", label: "Decision Tree", hint: "Animated flowchart with branching paths" },
  { id: "kinetic-type", label: "Kinetic Type", hint: "Bold kinetic typography promo" },
  {
    id: "product-promo",
    label: "Product Promo",
    hint: "Multi-scene product showcase with SVG assets",
  },
  { id: "nyt-graph", label: "NYT Graph", hint: "Animated data chart in print editorial style" },
];
