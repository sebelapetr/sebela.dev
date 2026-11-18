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
}

/** The storage key of the visitor's explicit choice. */
export const themeStorageKey = "sebela-theme";

/** The root element's attribute that carries an explicit choice; absent, the system decides. */
export const themeAttribute = "data-theme";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** The visitor's explicit choice, or null when there is none or the storage cannot be read. */
export function readThemeChoice(storage: () => ThemeStorage | null): Theme | null {
  try {
    const value = storage()?.getItem(themeStorageKey);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stores the visitor's choice; false when the storage refuses it. */
export function storeThemeChoice(storage: () => ThemeStorage | null, theme: Theme): boolean {
  try {
    const target = storage();
    if (target === null) return false;
    target.setItem(themeStorageKey, theme);
    return true;
  } catch {
    return false;
  }
}

/** The theme shown: the explicit choice, otherwise the system's preference. */
export function resolveTheme(choice: Theme | null, systemDark: boolean): Theme {
  return choice ?? (systemDark ? "dark" : "light");
}

/** The other theme. */
export function toggledTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/**
 * Marks the root with an explicit choice. The stylesheet sets the tokens and `color-scheme` from
 * the attribute, so print can still force the light ones.
 */
export function applyThemeChoice(root: ThemeRoot, theme: Theme): void {
  root.setAttribute(themeAttribute, theme);
}

/**
 * The inline script that applies a stored choice before the first paint. It repeats
 * `readThemeChoice` and `applyThemeChoice` in plain script, because it runs before any bundle.
 */
export const themeScript = `(function(){try{var t=window.localStorage.getItem(${JSON.stringify(
  themeStorageKey,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute(${JSON.stringify(
  themeAttribute,
)},t);}}catch(e){}})();`;
