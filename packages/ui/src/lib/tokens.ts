// The colour tokens as values, for what is rendered outside CSS (the website's Open Graph preview
// images). They repeat the custom properties of `styles/globals.css` for the light (`:root`) and
// dark (`:root[data-theme="dark"]`) themes; a website test keeps the two identical.

/** The colours an image rendered outside CSS may use, named like the custom properties. */
export interface ColorTokens {
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly mutedForeground: string;
  readonly border: string;
}

export const colorTokens: { readonly light: ColorTokens; readonly dark: ColorTokens } = {
  light: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    card: "#f5f5f5",
    mutedForeground: "#525252",
    border: "#d4d4d4",
  },
  dark: {
    background: "#000000",
    foreground: "#ededed",
    card: "#0a0a0a",
    mutedForeground: "#a3a3a3",
    border: "#262626",
  },
};
