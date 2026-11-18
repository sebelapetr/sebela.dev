// Geist and Geist Mono through the `geist` package, which loads them with `next/font` (self-hosted,
// no request to a font service). Apply both `variable` class names to the root element; the
// stylesheet maps them to Tailwind's `font-sans` and `font-mono`.
export { GeistMono as fontMono } from "geist/font/mono";
export { GeistSans as fontSans } from "geist/font/sans";
