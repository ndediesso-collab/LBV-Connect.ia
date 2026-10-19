/**
 * ORIA Visual — point d'entrée mobile pour les neuf formats visuels.
 *
 * IMPORTANT : aucun rendu simplifié. Les neuf formats sont affichés par
 * les mêmes composants Web (ECharts, AG Grid, React Flow, SVG, Three.js,
 * MapLibre) au travers de la WebView et de /oria-visual-embed.
 *
 * À raccorder à ChatMobile.tsx après validation de ce moteur.
 */
import React from 'react';
import OriaVisualWebView, { type OriaVisualProps } from './OriaVisualWebView';

export type { OriaVisualProps, OriaVisualKind } from './OriaVisualWebView';

export default function OriaVisualMobile(props: OriaVisualProps) {
  return <OriaVisualWebView {...props} />;
}
