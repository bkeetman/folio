export const TAG_COLORS = [
  { name: "Amber", value: "amber" },
  { name: "Rose", value: "rose" },
  { name: "Sky", value: "sky" },
  { name: "Emerald", value: "emerald" },
  { name: "Violet", value: "violet" },
  { name: "Slate", value: "slate" },
];

const TAG_COLOR_CLASSES: Record<string, string> = {
  amber: "border-tag-amber/40 bg-tag-amber/20",
  rose: "border-tag-rose/40 bg-tag-rose/20",
  sky: "border-tag-sky/40 bg-tag-sky/20",
  emerald: "border-tag-emerald/40 bg-tag-emerald/20",
  violet: "border-tag-violet/40 bg-tag-violet/20",
  slate: "border-tag-slate/40 bg-tag-slate/20",
};

const TAG_COLOR_SWATCH: Record<string, string> = {
  amber: "bg-tag-amber",
  rose: "bg-tag-rose",
  sky: "bg-tag-sky",
  emerald: "bg-tag-emerald",
  violet: "bg-tag-violet",
  slate: "bg-tag-slate",
};

export const getTagColorClass = (color?: string | null) =>
  TAG_COLOR_CLASSES[color ?? "amber"] ?? TAG_COLOR_CLASSES.amber;

export const getTagSwatchClass = (color?: string | null) =>
  TAG_COLOR_SWATCH[color ?? "amber"] ?? TAG_COLOR_SWATCH.amber;
