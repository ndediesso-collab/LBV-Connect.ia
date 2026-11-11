#!/usr/bin/env python3
"""Correctif ciblé ORIA: page Mes créations et aperçus universels, sans modifier le backend.

Depuis la racine LBV-Connect.ia :
    python ORIA_Mes_Creations_Formats_V2/appliquer_correctif.py --check
    python ORIA_Mes_Creations_Formats_V2/appliquer_correctif.py --apply
"""
from __future__ import annotations
import argparse
from datetime import datetime
from pathlib import Path
import shutil
import sys

SCRIPT_ROOT = Path(__file__).resolve().parent
TARGET_REL = Path('Frontend/app/mes_creations/page.tsx')
COMPONENT_REL = Path('Frontend/components/oria-artifacts/UniversalArtifactPreview.tsx')

class PatchError(Exception):
    pass


def replace_once(source: str, before: str, after: str, what: str) -> str:
    count = source.count(before)
    if count != 1:
        raise PatchError(f'{what}: attendu une occurrence, trouvé {count}. Aucun fichier modifié.')
    return source.replace(before, after, 1)


def patch(source: str) -> str:
    if 'UniversalArtifactPreview' in source:
        raise PatchError('Ce correctif semble déjà présent. Aucune seconde application.')
    source = replace_once(source,
        'import { createClient } from "@/lib/supabase/client";',
        'import { createClient } from "@/lib/supabase/client";\nimport UniversalArtifactPreview, { type UniversalPreviewPayload } from "@/components/oria-artifacts/UniversalArtifactPreview";',
        'Import du nouveau lecteur universel')
    source = replace_once(source,
        'type FilterType = "all" | CreationKind;',
        'type FilterType = "all" | CreationKind;\ntype FileGroup = "all" | "documents" | "spreadsheets" | "presentations" | "code" | "data" | "archives" | "other";\ntype SpecificFileGroup = Exclude<FileGroup, "all">;',
        'Types des catégories de fichiers')
    source = replace_once(source,
        'kind: "pdf" | "docx" | "xlsx" | "text" | "unsupported";',
        'kind: "pdf" | "docx" | "xlsx" | "text" | "universal" | "unsupported";',
        'Type des aperçus')
    source = replace_once(source,
        '  spreadsheet?: SpreadsheetPreview;\n  error?: string;\n};',
        '  spreadsheet?: SpreadsheetPreview;\n  universal?: UniversalPreviewPayload;\n  error?: string;\n};',
        'Données de l’aperçu universel')
    source = replace_once(source,
        '  if (ext === "xlsx") return "xlsx";\n  return TEXT_PREVIEW_EXTENSIONS.has(ext) ? "text" : "unsupported";',
        '  if (ext === "xlsx") return "xlsx";\n  // CSV/TSV ont un aperçu tabulaire côté serveur ; les autres types binaires\n  // passent par le lecteur universel existant (PPTX, ODP, ODT, etc.).\n  if (ext === "csv" || ext === "tsv") return "universal";\n  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) return "text";\n  return ext ? "universal" : "unsupported";',
        'Choix de l’aperçu')
    source = replace_once(source,
        'function getCreationKind(item: CreationItem): CreationKind {\n  const explicit = String(item.creation_type || "").toLowerCase();\n  const mediaType = String(item.media_type || item.type || "").toLowerCase();\n\n  if (explicit === "video" || mediaType === "video") return "video";\n  if (explicit === "image" || mediaType === "image") return "image";\n  if (explicit === "artifact" || mediaType === "file" || Boolean(item.extension)) return "artifact";\n  return "image";\n}',
        'function getCreationKind(item: CreationItem): CreationKind {\n  const explicit = String(item.creation_type || "").toLowerCase();\n  const mediaType = String(item.media_type || item.type || "").toLowerCase();\n  // Priorité aux artefacts : un SVG généré comme fichier ne doit pas devenir\n  // une image de la galerie des médias.\n  if (explicit === "artifact") return "artifact";\n  if (explicit === "video" || mediaType === "video") return "video";\n  if (explicit === "image" || mediaType === "image") return "image";\n  if (mediaType === "file" || Boolean(item.extension) || Boolean(item.filename)) return "artifact";\n  return "image";\n}',
        'Classement correct des artefacts')
    source = replace_once(source,
        'function getFileLabel(item: CreationItem, language: OriaLanguage) {',
        '''const FILE_GROUP_LABELS: Record<OriaLanguage, Record<FileGroup, string>> = {
  fr: { all: "Tous les fichiers", documents: "Documents", spreadsheets: "Tableurs", presentations: "Présentations", code: "Code et Web", data: "Données", archives: "Archives", other: "Autres" },
  en: { all: "All files", documents: "Documents", spreadsheets: "Spreadsheets", presentations: "Presentations", code: "Code and Web", data: "Data", archives: "Archives", other: "Other" },
};

const FILE_GROUP_ORDER: FileGroup[] = ["all", "documents", "spreadsheets", "presentations", "code", "data", "archives", "other"];

function getFileGroup(item: CreationItem): SpecificFileGroup {
  const ext = artifactExtension(item);
  if (["pdf", "docx", "odt", "rtf", "epub", "txt", "md", "tex"].includes(ext)) return "documents";
  if (["xlsx", "ods", "csv", "tsv"].includes(ext)) return "spreadsheets";
  if (["pptx", "odp"].includes(ext)) return "presentations";
  if (["zip"].includes(ext)) return "archives";
  if (["sqlite", "json", "jsonl", "ndjson", "xml", "yaml", "yml", "ics", "vcf"].includes(ext)) return "data";
  if (["py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "html", "htm", "css", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "php", "rb", "sh", "ps1", "bat", "sql", "svg", "ini", "env", "toml", "log"].includes(ext)) return "code";
  return "other";
}

function getFileLabel(item: CreationItem, language: OriaLanguage) {''',
        'Catégories des fichiers générés')
    source = replace_once(source,
        '  const [filter, setFilter] =\n    useState<FilterType>("all");',
        '  const [filter, setFilter] =\n    useState<FilterType>("all");\n  const [fileGroup, setFileGroup] = useState<FileGroup>("all");',
        'État du filtre des fichiers')
    source = replace_once(source,
        '  const filteredCreations = useMemo(() => {\n    if (filter === "all") {\n      return creations;\n    }\n\n    return creations.filter(\n      (item) =>\n        getCreationKind(item) === filter,\n    );\n  }, [creations, filter]);',
        '''  const fileGroupCounts = useMemo(() => {
    const groups: Record<FileGroup, number> = {
      all: 0, documents: 0, spreadsheets: 0, presentations: 0, code: 0, data: 0, archives: 0, other: 0,
    };
    for (const item of creations) {
      if (getCreationKind(item) !== "artifact") continue;
      groups.all += 1;
      groups[getFileGroup(item)] += 1;
    }
    return groups;
  }, [creations]);

  const filteredCreations = useMemo(() => {
    if (filter === "all") return creations;
    if (filter === "artifact") {
      return creations.filter((item) => getCreationKind(item) === "artifact" &&
        (fileGroup === "all" || getFileGroup(item) === fileGroup));
    }
    return creations.filter((item) => getCreationKind(item) === filter);
  }, [creations, filter, fileGroup]);''',
        'Filtrage par formats')
    source = replace_once(source,
        '    const requestId = ++previewRequestRef.current;\n    setSelectedArtifact({ item, kind, loading: kind !== "unsupported" });\n    if (kind === "unsupported") return;\n    try {\n      if (kind === "docx" || kind === "xlsx") {',
        '''    const requestId = ++previewRequestRef.current;
    setSelectedArtifact({ item, kind, loading: kind !== "unsupported" });
    if (kind === "unsupported") return;
    try {
      if (kind === "universal") {
        const response = await fetchArtifactGet(
          `/${encodeURIComponent(item.id)}/universal-preview`,
        );
        const data: UniversalPreviewPayload & ApiError = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true ||
          !["text", "tables", "slides", "archive"].includes(data.kind || "")) {
          throw new Error(data.detail || data.message || UI[language].previewFailed);
        }
        if (requestId !== previewRequestRef.current) return;
        setSelectedArtifact({ item, kind, loading: false, universal: data });
        return;
      }
      if (kind === "docx" || kind === "xlsx") {''',
        'Chargement de l’aperçu universel')
    source = replace_once(source,
        '        {!loading &&\n          creations.length > 0 && (\n            <div className="mb-7 flex flex-wrap gap-2 oria-reveal oria-delay-1">',
        '        {!loading &&\n          creations.length > 0 && (\n            <div className="mb-7 flex flex-wrap gap-2 oria-reveal oria-delay-1">',
        'Ancrage des filtres (vérification)')
    source = replace_once(source,
        '        {error && (\n          <div className="mb-6 flex items-start justify-between gap-4 rounded-[21px] border border-red-200/70',
        '''        {filter === "artifact" && !loading && fileGroupCounts.all > 0 && (
          <div role="group" aria-label={language === "fr" ? "Types de fichiers" : "File types"}
            className="mb-6 flex flex-wrap gap-2 oria-reveal">
            {FILE_GROUP_ORDER.filter((group) => group === "all" || fileGroupCounts[group] > 0).map((group) => (
              <button key={group} type="button" onClick={() => setFileGroup(group)}
                aria-pressed={fileGroup === group}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${fileGroup === group
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-surface text-muted-strong hover:border-border-strong"}`}>
                {FILE_GROUP_LABELS[language][group]} <span className="opacity-60">{fileGroupCounts[group]}</span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-[21px] border border-red-200/70''',
        'Filtres secondaires')
    source = replace_once(source,
        '               ) : selectedArtifact.kind === "pdf" && selectedArtifact.pdfUrl ? (',
        '''               ) : selectedArtifact.kind === "universal" && selectedArtifact.universal ? (
                 <UniversalArtifactPreview preview={selectedArtifact.universal} language={language} />
               ) : selectedArtifact.kind === "pdf" && selectedArtifact.pdfUrl ? (''',
        'Rendu de l’aperçu universel')
    source = replace_once(source,
        '      "Retrouvez ici vos images, vidéos et fichiers générés avec Oria.",',
        '      "Retrouvez vos images, vidéos, présentations, documents, tableurs, livres numériques, archives et fichiers créés avec Oria.",',
        'Description française de la bibliothèque')
    source = replace_once(source,
        '      "Find your images, videos and files generated with Oria.",',
        '      "Find images, videos, presentations, documents, spreadsheets, ebooks, archives and other files generated with Oria.",',
        'Description anglaise de la bibliothèque')
    return source


def main() -> int:
    args = argparse.ArgumentParser(description=__doc__)
    mode = args.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='Vérification en lecture seule')
    mode.add_argument('--apply', action='store_true', help='Sauvegarder et appliquer')
    ns = args.parse_args()
    root = Path.cwd()
    target = root / TARGET_REL
    component = root / COMPONENT_REL
    if not target.is_file():
        print(f'ERREUR : {target} introuvable. Lancez depuis la racine de LBV-Connect.ia.', file=sys.stderr)
        return 1
    raw = target.read_bytes()
    use_crlf = b'\r\n' in raw
    try:
        original = raw.decode('utf-8-sig').replace('\r\n', '\n')
        revised = patch(original)
    except (UnicodeDecodeError, PatchError) as exc:
        print(f'CORRECTIF NON APPLICABLE : {exc}', file=sys.stderr)
        return 1
    if ns.check:
        print('OK : les ancres du fichier Mes créations sont conformes.')
        print('OK : aperçu universel, filtres et classement des fichiers applicables.')
        print('Fichiers concernés :')
        print('  MODIF  ', TARGET_REL.as_posix())
        print('  AJOUT  ', COMPONENT_REL.as_posix())
        print('Aucune modification effectuée.')
        return 0
    if component.exists():
        print(f'ERREUR : {component} existe déjà. Aucun fichier modifié.', file=sys.stderr)
        return 1
    try:
        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup = target.with_name(f'{target.name}.bak_oria_formats_{stamp}')
        if backup.exists():
            raise PatchError('Une sauvegarde du même nom existe déjà.')
        shutil.copy2(target, backup)
        component.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SCRIPT_ROOT / 'components/oria-artifacts/UniversalArtifactPreview.tsx', component)
        out = revised.replace('\n', '\r\n') if use_crlf else revised
        target.write_bytes(out.encode('utf-8'))
    except Exception as exc:
        print(f'ERREUR : {exc}. Vérifiez les fichiers et utilisez la sauvegarde si nécessaire.', file=sys.stderr)
        return 1
    print('OK : page Mes créations mise à jour.')
    print('Sauvegarde :', backup)
    print('Nouveau lecteur :', component)
    print('Formats : PPTX/ODP, ODT/RTF/EPUB, ODS/CSV/TSV, ZIP, SQLite, autres formats textuels.')
    print('Aucune modification de la génération, des crédits ni des paiements.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
