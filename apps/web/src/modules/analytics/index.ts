// The analytics module: the optional, cookieless page-view analytics (an Umami-compatible tracker)
// that the root layout renders. Server-side it validates `WEB_ANALYTICS_SCRIPT_URL` and
// `WEB_ANALYTICS_WEBSITE_ID` on each request and renders nothing without usable settings; in the
// browser it loads the tracker after the page is interactive with automatic tracking off and
// reports only canonical page paths — never a query, a fragment, a conversation identifier, a
// question or an answer. A failing tracker never affects the page.
import "server-only";

export { Analytics } from "./components/analytics";
