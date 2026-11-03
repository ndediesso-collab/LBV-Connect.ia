
import type { MetadataRoute } from "next";

const origin = "https://www.myoriaai.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/fonctionnement`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/packs`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${origin}/help`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/legal`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
