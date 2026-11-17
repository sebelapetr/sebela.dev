"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  applyThemeChoice,
  readThemeChoice,
  resolveTheme,
  storeThemeChoice,
  type Theme,
  themeAttribute,
  themeStorageKey,
} from "../theme";

const systemDarkQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function browserStorage(): Storage {
  return window.localStorage;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Another tab chose a theme: show it here too. */
function onStorage(event: StorageEvent): void {
  if (event.key !== themeStorageKey) return;
  const choice = readThemeChoice(browserStorage);
  if (choice !== null) applyThemeChoice(document.documentElement, choice);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const system = window.matchMedia(systemDarkQuery);
  system.addEventListener("change", listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    system.removeEventListener("change", listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** The theme shown now: the root's explicit choice, otherwise the system's preference. */
function shownTheme(): Theme {
  const attribute = document.documentElement.getAttribute(themeAttribute);
  const choice = attribute === "light" || attribute === "dark" ? attribute : null;
  return resolveTheme(choice, window.matchMedia(systemDarkQuery).matches);
}

/** Not known on the server: the pre-paint script and the stylesheet decide there. */
function serverTheme(): null {
  return null;
}

/**
 * The theme shown and a way to choose one. `theme` is null until hydration, so the server's
 * markup never guesses. A choice applies at once and is kept when the storage allows it; when it
 * does not, it still applies to this page.
 */
export function useTheme(): {
  readonly theme: Theme | null;
  readonly choose: (theme: Theme) => void;
} {
  const theme = useSyncExternalStore(subscribe, shownTheme, serverTheme);
  const choose = useCallback((next: Theme) => {
    applyThemeChoice(document.documentElement, next);
    storeThemeChoice(browserStorage, next);
    notify();
  }, []);
  return { theme, choose };
}
