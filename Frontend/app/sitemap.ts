
import type { MetadataRoute } from "next";

const origin = "https://www.myoriaai.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1, images: [`${origin}/oria-logo.png`] },
    {
      url: `${origin}/fonctionnement`,
      changeFrequency: "monthly",
      priority: 0.8,
      images: [
        `${origin}/oria/oria-mini-studio-image.webp`,
        `${origin}/oria/oria-mini-studio-video.webp`,
      ],
    },
    { url: `${origin}/packs`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${origin}/help`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/legal`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
