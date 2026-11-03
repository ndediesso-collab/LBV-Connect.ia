import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // Les pages privées portent un en-tête X-Robots-Tag: noindex.
    // On ne les bloque pas ici afin que les robots puissent lire cette directive.
    // Leur contenu reste protégé par l'authentification et les autorisations API.
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: "https://www.myoriaai.com/sitemap.xml",
  };
}
