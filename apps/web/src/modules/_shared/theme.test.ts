import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  applyThemeChoice,
  readThemeChoice,
  resolveTheme,
  storeThemeChoice,
  themeAttribute,
  themeScript,
  themeStorageKey,
  toggledTheme,
  type ThemeStorage,
} from "./theme";

/** A storage that holds values in memory, like the browser's `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & {
  readonly values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

/** A storage the browser refuses: private mode, disabled cookies, a full quota. */
const refusingStorage: ThemeStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

/** The root element: only what the theme touches. */
function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
  };
}

describe("readThemeChoice", () => {
  it("reads the visitor's explicit choice", () => {
    expect(readThemeChoice(() => memoryStorage({ [themeStorageKey]: "dark" }))).toBe("dark");
    expect(readThemeChoice(() => memoryStorage({ [themeStorageKey]: "light" }))).toBe("light");
  });

  it("is null without a choice, so the system decides", () => {
    expect(readThemeChoice(() => memoryStorage())).toBeNull();
  });

  it("ignores a value it did not write", () => {
    expect(readThemeChoice(() => memoryStorage({ [themeStorageKey]: "system" }))).toBeNull();
    expect(readThemeChoice(() => memoryStorage({ [themeStorageKey]: " dark" }))).toBeNull();
    expect(readThemeChoice(() => memoryStorage({ [themeStorageKey]: "" }))).toBeNull();
  });

  it("is null when the storage cannot be reached or read, never throwing", () => {
    expect(readThemeChoice(() => refusingStorage)).toBeNull();
    expect(
      readThemeChoice(() => {
        throw new Error("SecurityError");
      }),
    ).toBeNull();
    expect(readThemeChoice(() => null)).toBeNull();
  });
});

describe("storeThemeChoice", () => {
  it("stores the choice and says so", () => {
    const storage = memoryStorage();
    expect(storeThemeChoice(() => storage, "dark")).toBe(true);
    expect(storage.values[themeStorageKey]).toBe("dark");
    expect(readThemeChoice(() => storage)).toBe("dark");
  });

  it("says it could not store the choice, never throwing", () => {
    expect(storeThemeChoice(() => refusingStorage, "light")).toBe(false);
    expect(
      storeThemeChoice(() => {
        throw new Error("SecurityError");
      }, "light"),
    ).toBe(false);
    expect(storeThemeChoice(() => null, "light")).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("follows the system without an explicit choice", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("keeps an explicit choice whatever the system prefers", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("toggledTheme", () => {
  it("switches to the other theme", () => {
    expect(toggledTheme("light")).toBe("dark");
    expect(toggledTheme("dark")).toBe("light");
  });
});

describe("applyThemeChoice", () => {
  it("marks the root with the choice", () => {
    const root = fakeRoot();
    applyThemeChoice(root, "dark");
    expect(root.getAttribute(themeAttribute)).toBe("dark");
    applyThemeChoice(root, "light");
    expect(root.getAttribute(themeAttribute)).toBe("light");
  });
});

describe("themeScript", () => {
  /** Runs the inline script as the browser does before the first paint. */
  function run(storage: ThemeStorage | (() => never)) {
    const root = fakeRoot();
    const window = {
      get localStorage() {
        if (typeof storage === "function") storage();
        return storage;
      },
    };
    runInNewContext(themeScript, { document: { documentElement: root }, window });
    return root;
  }

  it("applies a stored choice before the page is shown", () => {
    const root = run(memoryStorage({ [themeStorageKey]: "dark" }));
    expect(root.getAttribute(themeAttribute)).toBe("dark");
  });

  it("leaves the root alone without a choice, so the system's preference applies", () => {
    const root = run(memoryStorage());
    expect(root.getAttribute(themeAttribute)).toBeNull();
  });

  it("leaves the root alone for a value it did not write", () => {
    const root = run(memoryStorage({ [themeStorageKey]: "<script>" }));
    expect(root.getAttribute(themeAttribute)).toBeNull();
  });

  it("does not throw when the storage is refused", () => {
    expect(run(refusingStorage).getAttribute(themeAttribute)).toBeNull();
    expect(
      run(() => {
        throw new Error("SecurityError");
      }).getAttribute(themeAttribute),
    ).toBeNull();
  });
});
