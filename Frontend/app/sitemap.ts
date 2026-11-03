import type { MetadataRoute } from "next";

// Pages publiques existantes. Les comptes, créations et conversations sont exclus.
const origin = "https://www.myoriaai.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/help`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/legal`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
