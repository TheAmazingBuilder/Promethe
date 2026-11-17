import type { MetadataRoute } from "next";

/**
 * Web app manifest - makes Promethe installable on phones ("Add to Home
 * Screen" / install prompt): standalone display, emerald theme, existing
 * brand icons (no new assets needed).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Promethe - Journal de trading",
    short_name: "Promethe",
    description:
      "Journal de trading XAUUSD et Forex : trades, stratégies et analyses.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#09090b",
    theme_color: "#10b981",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
