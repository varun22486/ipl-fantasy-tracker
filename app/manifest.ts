import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IPL Fantasy Tracker",
    short_name: "IPL Fantasy",
    description: "Head-to-head IPL fantasy — live scores, lineups, season analytics",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#eef2f9",
    theme_color: "#0c1222",
    categories: ["sports", "entertainment"],
  };
}
