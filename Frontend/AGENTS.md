<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Thème (theme) — instructions pour les agents

- **But :** Le frontend supporte deux thèmes `light` / `dark`. La préférence est persistée dans la table `profiles` (Supabase) et appliquée en ajoutant/enlevant la classe `dark` sur `html` et en réglant `color-scheme`.
- **Principaux fichiers à consulter :**
	- [Frontend/components/providers/ThemeProvider.tsx](Frontend/components/providers/ThemeProvider.tsx) — logique React, hook `useTheme()`.
	- [Frontend/app/globals.css](Frontend/app/globals.css) — variables CSS et styles pour `.dark`.
	- [Frontend/app/layout.tsx](Frontend/app/layout.tsx) — où `ThemeProvider` est monté.
	- [Frontend/app/settings/page.tsx](Frontend/app/settings/page.tsx) — exemple d'interface pour changer le thème.
- **Règles pratiques :**
	- Utiliser `useTheme()` pour lire/mettre à jour le thème. Ne pas manipuler `document.documentElement.classList` ailleurs.
	- Modifier les couleurs via les variables CSS (`--background`, `--surface`, etc.) dans `globals.css` plutôt que de dupliquer des styles.
	- Les valeurs autorisées sont exactement `"light"` et `"dark"`.
	- Les changements côté client mettent d'abord à jour l'UI, puis tentent de sauvegarder la préférence dans Supabase ; en cas d'erreur, l'ancien thème est restauré.
- **Quand demander au backend :** si vous modifiez la forme ou le nom de la colonne `theme` dans `profiles`, mettez à jour l'initialisation et les requêtes dans `ThemeProvider.tsx` et vérifiez les migrations côté backend.
- **Notes rapides pour l'agent :** l'interface et les messages d'erreur sont en français dans ces fichiers — maintenir la langue lors de modifications UX.
