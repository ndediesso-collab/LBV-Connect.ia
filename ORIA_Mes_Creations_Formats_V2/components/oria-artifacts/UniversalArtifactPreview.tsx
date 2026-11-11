"use client";

/**
 * Aperçus universels ORIA — rendus inertes en lecture seule.
 * Les données viennent exclusivement de /ai/artifacts/{id}/universal-preview,
 * après contrôle de propriété par le backend. Aucun HTML ni code n'est exécuté.
 */
export type UniversalPreviewPayload = {
  success?: boolean;
  kind?: "text" | "tables" | "slides" | "archive";
  text?: string;
  truncated?: boolean;
  note?: string;
  slides?: Array<{
    title?: string;
    texts?: string[];
    image_data?: string;
  }>;
  tables?: Array<{ name?: string; rows?: unknown[][] }>;
  entries?: Array<{ name?: string; size?: number }>;
};

const PREVIEW_LABELS = {
  fr: {
    empty: "Aucun contenu lisible dans l'aperçu.",
    truncated: "Aperçu partiel : téléchargez le fichier pour consulter son contenu complet.",
    slide: "Diapositive",
    sheet: "Tableau",
    archive: "Contenu de l'archive",
    file: "Fichier",
    noPreview: "Aperçu indisponible pour ce format. Le téléchargement reste possible.",
  },
  en: {
    empty: "No readable content in this preview.",
    truncated: "Partial preview: download the file to view its full contents.",
    slide: "Slide",
    sheet: "Table",
    archive: "Archive contents",
    file: "File",
    noPreview: "Preview unavailable for this format. Download is still available.",
  },
} as const;

function safeSlideImage(data: unknown): string | undefined {
  // Le serveur fournit uniquement des JPEG réduits, jamais du SVG/HTML actif.
  return typeof data === "string" && data.length < 2_200_000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data)
    ? data : undefined;
}

function plainCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value) : "";
}

export default function UniversalArtifactPreview({
  preview,
  language,
}: {
  preview: UniversalPreviewPayload;
  language: "fr" | "en";
}) {
  const ui = PREVIEW_LABELS[language];
  const note = typeof preview.note === "string" ? preview.note : "";

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {preview.kind === "text" ? (
        <pre className="whitespace-pre-wrap break-words rounded-2xl border border-black/10 bg-white p-5 font-mono text-xs leading-6 text-[#18202c] sm:p-8">
          {preview.text || ui.empty}
        </pre>
      ) : preview.kind === "tables" ? (
        <div className="space-y-5">
          {preview.tables?.length ? preview.tables.map((table, tableIndex) => (
            <section key={`${table.name || "table"}-${tableIndex}`} className="overflow-hidden rounded-2xl border border-black/10 bg-white text-[#18202c]">
              <h3 className="border-b border-black/10 px-4 py-3 text-sm font-semibold">
                {table.name || `${ui.sheet} ${tableIndex + 1}`}
              </h3>
              <div className="max-h-[64vh] overflow-auto">
                <table className="w-max min-w-full border-collapse text-left text-xs">
                  <tbody>
                    {table.rows?.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                          <td key={cellIndex} className="max-w-64 min-w-24 whitespace-pre-wrap break-words border-b border-r border-black/10 px-3 py-2 align-top">
                            {plainCell(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )) : <p className="text-center text-sm text-muted">{ui.empty}</p>}
        </div>
      ) : preview.kind === "slides" ? (
        <div className="grid gap-5 md:grid-cols-2">
          {preview.slides?.length ? preview.slides.map((slide, index) => {
            const image = safeSlideImage(slide.image_data);
            return (
              <section key={index} className="overflow-hidden rounded-2xl border border-black/10 bg-white text-[#18202c] shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3">
                  <h3 className="min-w-0 truncate text-sm font-semibold">{slide.title || `${ui.slide} ${index + 1}`}</h3>
                  <span className="shrink-0 text-xs text-black/45">{index + 1}</span>
                </div>
                {image ? (
                  <img src={image} alt={`${ui.slide} ${index + 1}`} className="aspect-video w-full object-contain" />
                ) : (
                  <div className="flex min-h-[210px] flex-col justify-center gap-3 p-6">
                    {slide.texts?.length ? slide.texts.map((line, textIndex) => (
                      <p key={textIndex} className={textIndex === 0 ? "whitespace-pre-wrap break-words text-lg font-semibold" : "whitespace-pre-wrap break-words text-sm leading-6"}>
                        {line}
                      </p>
                    )) : <p className="text-sm text-black/50">{ui.empty}</p>}
                  </div>
                )}
              </section>
            );
          }) : <p className="text-center text-sm text-muted">{ui.empty}</p>}
        </div>
      ) : preview.kind === "archive" ? (
        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white text-[#18202c]">
          <h3 className="border-b border-black/10 px-4 py-3 text-sm font-semibold">{ui.archive}</h3>
          <ul className="max-h-[70vh] divide-y divide-black/10 overflow-auto">
            {preview.entries?.length ? preview.entries.map((entry, index) => (
              <li key={index} className="flex items-start justify-between gap-4 px-4 py-3 text-xs sm:text-sm">
                <span className="min-w-0 break-all font-mono">{entry.name || `${ui.file} ${index + 1}`}</span>
                <span className="shrink-0 text-black/50">{typeof entry.size === "number" && Number.isFinite(entry.size) ? `${entry.size.toLocaleString(language === "fr" ? "fr-FR" : "en-US")} B` : ""}</span>
              </li>
            )) : <li className="px-4 py-6 text-sm text-black/50">{ui.empty}</li>}
          </ul>
        </section>
      ) : (
        <p className="py-12 text-center text-sm text-muted">{ui.noPreview}</p>
      )}
      {note && <p className="rounded-xl bg-surface px-4 py-3 text-xs leading-6 text-muted-strong">{note}</p>}
      {preview.truncated && <p role="status" className="text-xs font-semibold text-muted-strong">{ui.truncated}</p>}
    </div>
  );
}
