import { ImageResponse } from "next/og";

import { colorTokens } from "@sebela/ui/lib/tokens";

import { OPEN_GRAPH_IMAGE_SIZE, type OpenGraphCard } from "../data/open-graph-card";

const colors = colorTokens.dark;

/**
 * The preview image's layout for `next/og`, which understands only inline styles and flex layout:
 * the dark theme's tokens, black, white and greys only, the site's host above a rule, the page's
 * name as a small label, the person's name and headline set large. No photo and no decoration.
 */
function OpenGraphImage({ card }: { readonly card: OpenGraphCard }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        backgroundColor: colors.background,
        color: colors.foreground,
      }}
    >
      <div
        style={{
          display: "flex",
          paddingBottom: 24,
          borderBottom: `2px solid ${colors.border}`,
          color: colors.mutedForeground,
          fontSize: 28,
        }}
      >
        {card.site}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {card.label === null ? null : (
          <div style={{ display: "flex", color: colors.mutedForeground, fontSize: 32 }}>
            {card.label}
          </div>
        )}
        <div
          style={{
            display: "flex",
            marginTop: 16,
            fontSize: 80,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          {card.title}
        </div>
        {card.subtitle === null ? null : (
          <div
            style={{
              display: "flex",
              marginTop: 24,
              color: colors.mutedForeground,
              fontSize: 36,
              lineHeight: 1.35,
            }}
          >
            {card.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/** The card rendered to a PNG of the Open Graph size, with `cacheControl` as its caching. */
export function openGraphImage(card: OpenGraphCard, cacheControl: string): ImageResponse {
  return new ImageResponse(<OpenGraphImage card={card} />, {
    ...OPEN_GRAPH_IMAGE_SIZE,
    headers: { "Cache-Control": cacheControl },
  });
}
