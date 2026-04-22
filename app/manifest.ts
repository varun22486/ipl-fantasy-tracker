import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IPL Fantasy Tracker",
    short_name: "IPL Fantasy",
    description: "Head-to-head IPL fantasy — live scores, lineups, season analytics",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#e8edf6",
    theme_color: "#0a1628",
    categories: ["sports", "entertainment"],
  };
}
