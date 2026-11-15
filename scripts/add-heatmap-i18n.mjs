/**
 * i18n merge for v2.5 Module 2 Phase 2 (heatmaps) + Phase 1 patch
 * (tabs.heatmaps). Idempotent — safe to re-run.
 */
import { readFileSync, writeFileSync } from "node:fs";

const heatmapEn = {
  title: "Cross heatmaps",
  description:
    "Two dimensions, one metric — spot the pockets that pay and the ones that cost.",
  configTitle: "Configuration",
  configDesc: "Pick two dimensions and a metric. Cells below the minimum sample size are hatched.",
  rowDimension: "Rows",
  colDimension: "Columns",
  metric: "Metric",
  ordering: "Ordering",
  orderNatural: "Natural",
  orderPerformance: "By performance",
  minSample: "Min. sample per cell",
  matrixDesc:
    "Diverging scale centered on zero — green = positive, red = negative, intensity = magnitude. Cells with fewer than {minSample} trades are hatched and excluded from the scale.",
  presets: {
    dayHour: "Day × hour",
    sessionInstrument: "Session × instrument",
    strategyEmotion: "Strategy × emotion",
    weekdaySession: "Weekday × session",
    instrumentStrategy: "Instrument × strategy",
    regimeStrategy: "Regime × strategy",
  },
  total: "Total",
  legend: "Scale",
  legendGain: "positive",
  legendLoss: "negative",
  legendLowSample: "low sample (hatched)",
  ariaLabel: "Cross heatmap matrix",
  hoverHint: "Hover or focus a cell for details. Arrow keys move, Enter drills down.",
  keyboardHint:
    "Keyboard: focus the matrix, move with the arrow keys, press Enter to drill down.",
  nTrades: "{count} trades",
  winsLosses: "{wins} W / {losses} L",
  confidenceHint: "small sample — interpret with care",
  lowSampleHint: "below the minimum sample size",
  rowColHeader: "Row \\ Column",
};

const heatmapFr = {
  title: "Heatmaps croisées",
  description:
    "Deux dimensions, une métrique — repérez les poches qui paient et celles qui coûtent.",
  configTitle: "Configuration",
  configDesc:
    "Choisissez deux dimensions et une métrique. Les cellules sous la taille d'échantillon minimale sont hachurées.",
  rowDimension: "Lignes",
  colDimension: "Colonnes",
  metric: "Métrique",
  ordering: "Tri",
  orderNatural: "Naturel",
  orderPerformance: "Par performance",
  minSample: "Échantillon min. par cellule",
  matrixDesc:
    "Échelle divergente centrée sur zéro — vert = positif, rouge = négatif, intensité = magnitude. Les cellules de moins de {minSample} trades sont hachurées et exclues de l'échelle.",
  presets: {
    dayHour: "Jour × heure",
    sessionInstrument: "Session × instrument",
    strategyEmotion: "Stratégie × émotion",
    weekdaySession: "Jour × session",
    instrumentStrategy: "Instrument × stratégie",
    regimeStrategy: "Régime × stratégie",
  },
  total: "Total",
  legend: "Échelle",
  legendGain: "positif",
  legendLoss: "négatif",
  legendLowSample: "échantillon faible (hachuré)",
  ariaLabel: "Matrice heatmap croisée",
  hoverHint:
    "Survolez ou focalisez une cellule pour les détails. Flèches pour se déplacer, Entrée pour explorer.",
  keyboardHint:
    "Clavier : focalisez la matrice, déplacez-vous avec les flèches, Entrée pour explorer.",
  nTrades: "{count} trades",
  winsLosses: "{wins} G / {losses} P",
  confidenceHint: "petit échantillon — interpréter avec prudence",
  lowSampleHint: "sous la taille d'échantillon minimale",
  rowColHeader: "Ligne \\ Colonne",
};

function merge(path, patch, isEn) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.nav = json.nav ?? {};
  if (!json.nav.heatmaps) {
    json.nav.heatmaps = isEn ? "Heatmaps" : "Heatmaps";
  }
  if (!json.nav.heatmapsDesc) {
    json.nav.heatmapsDesc = isEn
      ? "Cross two dimensions, one metric"
      : "Croisez deux dimensions, une métrique";
  }
  json.chartsBuilder = json.chartsBuilder ?? {};
  json.chartsBuilder.tabs = {
    ...json.chartsBuilder.tabs,
    heatmaps: isEn ? "Heatmaps" : "Heatmaps",
  };
  json.chartsBuilder.heatmap = {
    ...(json.chartsBuilder.heatmap ?? {}),
    ...patch,
    presets: { ...(json.chartsBuilder.heatmap?.presets ?? {}), ...patch.presets },
  };
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  console.log(`✓ merged ${path}`);
}

merge("/home/z/my-project/messages/en.json", heatmapEn, true);
merge("/home/z/my-project/messages/fr.json", heatmapFr, false);
