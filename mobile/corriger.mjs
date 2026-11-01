/**
 * ORIA Mobile — correctif ciblé des 8 diagnostics TypeScript signalés le 01/11/2026.
 * Aucune API, aucun paiement, aucun écran ou comportement de création n'est réécrit.
 * Par défaut : aperçu sans écriture. Ajouter --apply pour appliquer.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const cli = process.argv.slice(2);
const repoIndex = cli.indexOf('--repo');
const given = path.resolve(repoIndex >= 0 ? (cli[repoIndex + 1] || '.') : '.');
const apply = cli.includes('--apply');
const root = fs.existsSync(path.join(given, 'mobile', 'package.json'))
  ? given
  : fs.existsSync(path.join(given, 'package.json')) && path.basename(given).toLowerCase() === 'mobile'
    ? path.dirname(given)
    : null;
if (!root) {
  console.error('Dossier de projet introuvable : lance la commande depuis LBV-Connect.ia ou mobile, avec --repo .');
  process.exit(2);
}

const changes = [
  {
    rel: 'mobile/src/app/settings/index.tsx',
    name: 'TS2769 — retirer backgroundColor du StatusBar de Paramètres',
    fix(source) {
      // Ne cible que le composant StatusBar, pas les fonds des View.
      const expr = /(<StatusBar\b(?:(?!\/>)[\s\S])*?)\s+backgroundColor=\{[^}\r\n]+\}(\s*\/\>)/g;
      return source.replace(expr, '$1$2');
    },
    isCorrect(source) {
      return /<StatusBar\b[\s\S]*?\/>/.test(source) &&
        !/<StatusBar\b(?:(?!\/>)[\s\S])*?backgroundColor=\{/.test(source);
    },
  },
  {
    rel: 'mobile/src/components/app-tabs.tsx',
    name: 'TS2367/TS2538 — traiter correctement useColorScheme() = dark/light/null',
    fix(source) {
      return source.replace(/Colors\[scheme\s*===\s*['"]unspecified['"]\s*\?\s*['"]light['"]\s*:\s*scheme\]/g,
        "Colors[scheme === 'dark' ? 'dark' : 'light']");
    },
    isCorrect(source) {
      return /Colors\[scheme\s*===\s*['"]dark['"]\s*\?\s*['"]dark['"]\s*:\s*['"]light['"]\]/.test(source);
    },
  },
  {
    rel: 'mobile/src/components/app-tabs.web.tsx',
    name: 'TS2367/TS2538/TS2322 — thème nullable et ref incompatible sur Pressable',
    fix(source) {
      let output = source.replace(/Colors\[scheme\s*===\s*['"]unspecified['"]\s*\?\s*['"]light['"]\s*:\s*scheme\]/g,
        "Colors[scheme === 'dark' ? 'dark' : 'light']");
      // TabTriggerSlotProps porte une ref de l'élément du slot, de type incompatible
      // avec la ref du Pressable RN. Ne jamais propager cette ref par ...props.
      output = output.replace(/(function\s+TabButton\s*\(\s*\{\s*children\s*,\s*isFocused\s*,\s*)\.\.\.props(\s*\}\s*:\s*TabTriggerSlotProps)/,
        '$1ref: _oriaSlotRef, ...props$2');
      return output;
    },
    isCorrect(source) {
      return /Colors\[scheme\s*===\s*['"]dark['"]\s*\?\s*['"]dark['"]\s*:\s*['"]light['"]\]/.test(source) &&
        /function\s+TabButton\s*\(\s*\{[^}]*\bref\s*:\s*_oriaSlotRef\s*,\s*\.\.\.props/.test(source);
    },
  },
  {
    rel: 'mobile/src/hooks/use-theme.ts',
    name: 'TS2367/TS2538 — supprimer unspecified et fallback null',
    fix(source) {
      return source.replace(/const\s+theme\s*=\s*scheme\s*===\s*['"]unspecified['"]\s*\?\s*['"]light['"]\s*:\s*scheme\s*;/,
        "const theme = scheme === 'dark' ? 'dark' : 'light';");
    },
    isCorrect(source) {
      return /const\s+theme\s*=\s*scheme\s*===\s*['"]dark['"]\s*\?\s*['"]dark['"]\s*:\s*['"]light['"]\s*;/.test(source);
    },
  },
];

let ts;
try {
  const requireFromMobile = createRequire(path.join(root, 'mobile', 'package.json'));
  ts = requireFromMobile('typescript');
} catch {
  // L'analyse de syntaxe est facultative ; npx tsc --noEmit reste la vérification complète.
  ts = null;
}

const prepared = [];
for (const item of changes) {
  const filename = path.join(root, item.rel);
  if (!fs.existsSync(filename)) {
    console.error(`Fichier absent : ${item.rel}`);
    process.exit(3);
  }
  const before = fs.readFileSync(filename, 'utf8');
  const after = item.fix(before);
  if (!item.isCorrect(after)) {
    console.error(`Structure inattendue : ${item.rel}. Rien n'a été modifié.`);
    process.exit(4);
  }
  if (ts) {
    const syntax = ts.createSourceFile(filename, after, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    if (syntax.parseDiagnostics.length) {
      console.error(`Erreur syntaxique après correctif dans ${item.rel} :`, syntax.parseDiagnostics[0].messageText);
      process.exit(5);
    }
  }
  prepared.push({ ...item, filename, before, after });
}

for (const entry of prepared) {
  console.log(`${entry.after === entry.before ? 'DÉJÀ CORRIGÉ' : apply ? 'À CORRIGER' : 'APERÇU'} : ${entry.rel}`);
  console.log(`  ${entry.name}`);
}
if (prepared.every(item => item.before === item.after)) {
  console.log('\nAucune modification nécessaire. Vérifier avec : cd mobile; npx tsc --noEmit');
  process.exit(0);
}
if (!apply) {
  console.log('\nAucun fichier modifié (aperçu). Relancer avec --apply pour corriger.');
  process.exit(0);
}

const when = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(os.tmpdir(), 'oria-mobile-correctifs-ts', when);
for (const entry of prepared.filter(item => item.after !== item.before)) {
  const destination = path.join(backupRoot, entry.rel);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, entry.before, 'utf8');
}
let written = [];
try {
  for (const entry of prepared.filter(item => item.after !== item.before)) {
    fs.writeFileSync(entry.filename, entry.after, 'utf8');
    written.push(entry);
    console.log(`CORRIGÉ : ${entry.rel}`);
  }
} catch (error) {
  for (const entry of written) fs.writeFileSync(entry.filename, entry.before, 'utf8');
  console.error('Écriture interrompue : fichiers précédents restaurés.', error);
  process.exit(6);
}
console.log(`\nSauvegardes hors Git : ${backupRoot}`);
console.log('Étape suivante : cd mobile; npx tsc --noEmit');
