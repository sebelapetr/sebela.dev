// The colour theme: the system's preference until the visitor chooses, then the choice, kept in
// the browser's storage. Never throws when the storage is missing or refused.

/** A colour theme. */
export type Theme = "light" | "dark";

/** The part of the browser's storage the theme uses. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The root element's part the theme marks. */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  readonly style: { colorScheme: string };
}

/** The storage key of the visitor's explicit choice. */
export const themeStorageKey = "sebela-theme";

/** The root element's attribute that carries an explicit choice; absent, the system decides. */
export const themeAttribute = "data-theme";

/** The visitor's explicit choice, or null when there is none or the storage cannot be read. */
export const readThemeChoice: (storage: () => ThemeStorage | null) => Theme | null = () => {
  throw new Error("not implemented");
};

/** Stores the visitor's choice; false when the storage refuses it. */
export const storeThemeChoice: (
  storage: () => ThemeStorage | null,
  theme: Theme,
) => boolean = () => {
  throw new Error("not implemented");
};

/** The theme shown: the explicit choice, otherwise the system's preference. */
export const resolveTheme: (choice: Theme | null, systemDark: boolean) => Theme = () => {
  throw new Error("not implemented");
};

/** The other theme. */
export const toggledTheme: (theme: Theme) => Theme = () => {
  throw new Error("not implemented");
};

/** Marks the root with an explicit choice, so the tokens and the browser's controls follow it. */
export const applyThemeChoice: (root: ThemeRoot, theme: Theme) => void = () => {
  throw new Error("not implemented");
};

/** The inline script that applies a stored choice before the first paint. */
export const themeScript = "";
