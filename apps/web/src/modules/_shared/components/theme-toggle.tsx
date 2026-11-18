"use client";

import { Moon, Sun } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { useTheme } from "../hooks/use-theme";
import { toggledTheme } from "../theme";

/**
 * The light / dark switch: a toggle button named "Dark theme", pressed while dark shows. The icon
 * follows the theme through CSS, so it is right before hydration; the pressed state follows once
 * the theme is known. `withLabel` shows the name beside the icon (the mobile menu).
 */
export function ThemeToggle({
  withLabel = false,
  className,
}: {
  readonly withLabel?: boolean;
  readonly className?: string;
}) {
  const { theme, choose } = useTheme();
  const icons = (
    <>
      <Moon aria-hidden="true" className="dark:hidden" />
      <Sun aria-hidden="true" className="hidden dark:block" />
    </>
  );
  return (
    <button
      type="button"
      aria-pressed={theme === null ? undefined : theme === "dark"}
      aria-label={withLabel ? undefined : "Dark theme"}
      onClick={() => {
        if (theme !== null) choose(toggledTheme(theme));
      }}
      className={cn(
        buttonVariants({ variant: "ghost", size: withLabel ? "default" : "icon" }),
        withLabel && "justify-start px-3",
        className,
      )}
    >
      {icons}
      {withLabel ? "Dark theme" : null}
    </button>
  );
}
