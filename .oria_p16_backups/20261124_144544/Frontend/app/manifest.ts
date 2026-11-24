import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Oria",
    short_name: "Oria",
    description: "Oria",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/oria-logo.png", sizes: "1254x1254", type: "image/png" },
    ],
  };
}