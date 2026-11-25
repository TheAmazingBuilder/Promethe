/**
 * Gaia's first built-in pattern collection: Japanese candlesticks.
 *
 * Educational reference, not a signal engine. A candle pattern is a
 * context-dependent price-action observation and must not be treated as
 * a standalone trade recommendation.
 */
import {
  CANDLESTICK_PATTERN_CATEGORIES,
  type CandlestickPattern,
  type CandlestickPatternSearchOptions,
} from "./types";

export {
  CANDLESTICK_PATTERN_CATEGORIES,
  type CandlestickPattern,
  type CandlestickPatternBias,
  type CandlestickPatternCategory,
  type CandlestickPatternSearchOptions,
} from "./types";

const CANDLESTICK_PATTERNS = [
  {
    id: "doji",
    name: "Doji",
    aliases: ["doji", "indecision", "neutral candle", "égalité ouverture clôture"],
    category: "indecision",
    bias: "neutral",
    candles: 1,
    description: "La bougie ouvre et clôture à des prix identiques ou très proches : son corps est presque inexistant.",
    marketContext: "Elle attire davantage l'attention après un mouvement directionnel marqué ou près d'une zone technique importante.",
    interpretation: "Elle traduit un équilibre temporaire entre acheteurs et vendeurs, ou une hésitation du marché. Elle ne donne pas, à elle seule, une direction fiable.",
    confirmation: "Attendre la réaction de la bougie suivante et vérifier la position par rapport à la structure, au support ou à la résistance.",
    caveats: "Un Doji isolé au milieu d'un marché sans tendance est souvent peu informatif. La taille des mèches varie selon sa sous-catégorie.",
    illustration: "/patterns/candlesticks/doji.svg",
  },
  {
    id: "long-legged-doji",
    name: "Long-Legged Doji",
    aliases: ["long legged doji", "long-legged", "doji longues mèches", "doji à longues jambes"],
    category: "indecision",
    bias: "neutral",
    candles: 1,
    description: "Doji doté de longues mèches supérieure et inférieure, avec un corps très réduit.",
    marketContext: "À surveiller après une extension de prix ou autour d'un niveau où le marché doit choisir une direction.",
    interpretation: "Les deux camps ont poussé le prix loin du cours d'ouverture, mais aucun n'a conservé l'avantage à la clôture.",
    confirmation: "Observer une clôture ultérieure hors de la zone de la bougie et un contexte de marché cohérent.",
    caveats: "Les longues mèches peuvent aussi refléter une volatilité élevée ou un manque de liquidité.",
    illustration: "/patterns/candlesticks/long-legged-doji.svg",
  },
  {
    id: "dragonfly-doji",
    name: "Dragonfly Doji",
    aliases: ["dragonfly", "dragonfly doji", "doji libellule"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 1,
    description: "Doji en forme de T : longue mèche basse, corps situé près du plus haut et peu ou pas de mèche haute.",
    marketContext: "Sa lecture haussière est plus pertinente après une baisse ou sur un support identifié.",
    interpretation: "Les vendeurs ont d'abord poussé le prix vers le bas, puis les acheteurs l'ont ramené près du niveau d'ouverture.",
    confirmation: "Une clôture haussière ultérieure, idéalement au-dessus du sommet du Doji, renforce l'hypothèse de retournement.",
    caveats: "Sans baisse préalable ni confirmation, la forme seule ne suffit pas à conclure à un retournement.",
    illustration: "/patterns/candlesticks/dragonfly-doji.svg",
  },
  {
    id: "gravestone-doji",
    name: "Gravestone Doji",
    aliases: ["gravestone", "gravestone doji", "doji pierre tombale"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 1,
    description: "Doji en forme de T inversé : longue mèche haute, corps près du plus bas et peu ou pas de mèche basse.",
    marketContext: "À observer après une hausse ou au contact d'une résistance.",
    interpretation: "Les acheteurs ont tenté de pousser le prix vers le haut, mais les vendeurs ont ramené la clôture près de l'ouverture.",
    confirmation: "Une clôture baissière ultérieure, de préférence sous le plus bas du Doji, renforce l'hypothèse.",
    caveats: "Le pattern n'est pas automatiquement baissier lorsqu'il apparaît dans une consolidation.",
    illustration: "/patterns/candlesticks/gravestone-doji.svg",
  },
  {
    id: "hammer",
    name: "Hammer",
    aliases: ["hammer", "marteau", "bullish hammer"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 1,
    description: "Petit corps situé dans la partie haute de la bougie, avec une longue mèche basse et une mèche haute courte ou absente.",
    marketContext: "Pattern potentiel de retournement après une baisse, particulièrement près d'un support.",
    interpretation: "La pression vendeuse a été rejetée et les acheteurs ont repris le contrôle avant la clôture.",
    confirmation: "Chercher une bougie suivante haussière et une progression au-dessus du sommet du Hammer.",
    caveats: "La couleur du corps est secondaire par rapport à sa forme, mais une clôture haussière peut renforcer la lecture.",
    illustration: "/patterns/candlesticks/hammer.svg",
  },
  {
    id: "hanging-man",
    name: "Hanging Man",
    aliases: ["hanging man", "pendu", "bearish hammer shape"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 1,
    description: "Forme proche du Hammer : petit corps en haut et longue mèche basse.",
    marketContext: "Il apparaît après une hausse et peut signaler une fragilisation de la dynamique acheteuse.",
    interpretation: "Les vendeurs ont réussi à faire baisser le prix pendant la séance, même si les acheteurs ont partiellement récupéré le mouvement.",
    confirmation: "Une clôture baissière sous le corps ou le plus bas du Hanging Man apporte une confirmation plus solide.",
    caveats: "La même forme après une baisse est généralement lue comme un Hammer, pas comme un Hanging Man.",
    illustration: "/patterns/candlesticks/hanging-man.svg",
  },
  {
    id: "inverted-hammer",
    name: "Inverted Hammer",
    aliases: ["inverted hammer", "marteau inversé"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 1,
    description: "Petit corps dans la partie basse, longue mèche haute et mèche basse courte ou absente.",
    marketContext: "Pattern potentiel de retournement après une baisse.",
    interpretation: "Les acheteurs ont tenté une remontée importante, mais le prix a clôturé loin du plus haut. Cette tentative peut annoncer un changement de rapport de force.",
    confirmation: "Une bougie haussière suivante qui dépasse le sommet de l'Inverted Hammer est préférable.",
    caveats: "La longue mèche haute sans confirmation peut simplement montrer un rejet vendeur.",
    illustration: "/patterns/candlesticks/inverted-hammer.svg",
  },
  {
    id: "shooting-star",
    name: "Shooting Star",
    aliases: ["shooting star", "étoile filante"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 1,
    description: "Petit corps près du bas de la bougie, longue mèche haute et mèche basse courte ou absente.",
    marketContext: "Potentiel signal de retournement après une hausse, notamment près d'une résistance.",
    interpretation: "La hausse intrabougie a été rejetée et les vendeurs ont ramené le prix près de l'ouverture.",
    confirmation: "Une clôture baissière suivante sous le corps ou le plus bas renforce le scénario.",
    caveats: "Ne pas confondre avec l'Inverted Hammer : la forme est similaire, mais le contexte de marché diffère.",
    illustration: "/patterns/candlesticks/shooting-star.svg",
  },
  {
    id: "bullish-engulfing",
    name: "Bullish Engulfing",
    aliases: ["bullish engulfing", "avalement haussier", "englobante haussière"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 2,
    description: "Une bougie haussière dont le corps englobe le corps de la bougie baissière précédente.",
    marketContext: "Plus significatif après une baisse ou à proximité d'une zone de demande.",
    interpretation: "La deuxième bougie montre un basculement marqué de la pression vendeuse vers la pression acheteuse.",
    confirmation: "Une poursuite haussière ou une cassure d'un niveau local peut confirmer le changement de dynamique.",
    caveats: "L'englobement concerne les corps selon la définition classique ; les gaps ne sont pas indispensables sur tous les marchés continus.",
    illustration: "/patterns/candlesticks/bullish-engulfing.svg",
  },
  {
    id: "bearish-engulfing",
    name: "Bearish Engulfing",
    aliases: ["bearish engulfing", "avalement baissier", "englobante baissière"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 2,
    description: "Une bougie baissière dont le corps englobe le corps de la bougie haussière précédente.",
    marketContext: "Plus pertinent après une hausse ou près d'une résistance.",
    interpretation: "La deuxième bougie indique que les vendeurs ont pris le dessus sur les acheteurs de la bougie précédente.",
    confirmation: "Une clôture ultérieure sous la zone du pattern ou la cassure d'un creux local renforce le scénario.",
    caveats: "Un pattern contre une tendance forte peut échouer ; examiner le contexte et la taille relative des bougies.",
    illustration: "/patterns/candlesticks/bearish-engulfing.svg",
  },
  {
    id: "piercing-line",
    name: "Piercing Line",
    aliases: ["piercing line", "ligne de pénétration", "penetrating pattern"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 2,
    description: "Après une bougie baissière, une bougie haussière clôture au-dessus du milieu du corps précédent sans l'englober entièrement.",
    marketContext: "Potentiel retournement après une baisse.",
    interpretation: "Les acheteurs récupèrent une part importante de la perte de la première bougie.",
    confirmation: "Une poursuite haussière au-dessus du sommet de la deuxième bougie augmente la fiabilité de la lecture.",
    caveats: "Les critères de gap d'ouverture varient selon les marchés ; sur les marchés continus, le gap peut être absent.",
    illustration: "/patterns/candlesticks/piercing-line.svg",
  },
  {
    id: "dark-cloud-cover",
    name: "Dark Cloud Cover",
    aliases: ["dark cloud cover", "couverture en nuage noir"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 2,
    description: "Après une bougie haussière, une bougie baissière ouvre au-dessus ou près du sommet précédent puis clôture sous le milieu de son corps.",
    marketContext: "Potentiel retournement après une hausse ou près d'une résistance.",
    interpretation: "Les vendeurs effacent une partie importante de la progression acheteuse précédente.",
    confirmation: "Une clôture baissière supplémentaire ou la rupture d'un support proche renforce le scénario.",
    caveats: "Les gaps sont moins fréquents sur les marchés 24/5 ou continus ; adapter la définition à l'instrument.",
    illustration: "/patterns/candlesticks/dark-cloud-cover.svg",
  },
  {
    id: "morning-star",
    name: "Morning Star",
    aliases: ["morning star", "étoile du matin"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 3,
    description: "Séquence de trois bougies : forte bougie baissière, petite bougie d'hésitation, puis forte bougie haussière.",
    marketContext: "Pattern de retournement potentiel après une baisse prolongée.",
    interpretation: "La pression vendeuse ralentit, l'hésitation apparaît, puis les acheteurs reprennent l'initiative.",
    confirmation: "La troisième bougie devrait idéalement clôturer dans une part importante du corps de la première.",
    caveats: "La petite bougie centrale peut être un Doji (Morning Doji Star). Les gaps dépendent du marché.",
    illustration: "/patterns/candlesticks/morning-star.svg",
  },
  {
    id: "evening-star",
    name: "Evening Star",
    aliases: ["evening star", "étoile du soir"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 3,
    description: "Séquence de trois bougies : forte bougie haussière, petite bougie d'hésitation, puis forte bougie baissière.",
    marketContext: "Pattern de retournement potentiel après une hausse.",
    interpretation: "La dynamique acheteuse ralentit, l'hésitation s'installe, puis les vendeurs reprennent le contrôle.",
    confirmation: "La troisième bougie devrait idéalement clôturer profondément dans le corps de la première.",
    caveats: "La bougie centrale peut être un Doji (Evening Doji Star). Les gaps ne sont pas toujours présents.",
    illustration: "/patterns/candlesticks/evening-star.svg",
  },
  {
    id: "three-white-soldiers",
    name: "Three White Soldiers",
    aliases: ["three white soldiers", "trois soldats blancs", "trois soldats haussiers"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 3,
    description: "Trois longues bougies haussières successives, avec des clôtures progressives plus hautes et des corps relativement réguliers.",
    marketContext: "Peut marquer un retournement après une baisse ou confirmer une reprise depuis une base.",
    interpretation: "Les acheteurs dominent plusieurs périodes consécutives et font progresser le prix de manière soutenue.",
    confirmation: "Vérifier que les bougies ont des corps consistants, des clôtures proches de leurs sommets et peu de mèches hautes.",
    caveats: "Après une hausse déjà très étendue, la séquence peut signaler un mouvement tardif plutôt qu'une entrée intéressante.",
    illustration: "/patterns/candlesticks/three-white-soldiers.svg",
  },
  {
    id: "three-black-crows",
    name: "Three Black Crows",
    aliases: ["three black crows", "trois corbeaux noirs", "trois corbeaux baissiers"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 3,
    description: "Trois longues bougies baissières successives, avec des clôtures progressivement plus basses et des corps relativement réguliers.",
    marketContext: "Peut marquer un retournement après une hausse ou confirmer une dégradation de structure.",
    interpretation: "Les vendeurs dominent plusieurs périodes et imposent une progression baissière soutenue.",
    confirmation: "Rechercher des corps consistants, des clôtures proches des plus bas et des ouvertures dans le corps précédent.",
    caveats: "Après une forte baisse déjà étendue, le pattern peut être tardif ; éviter de le lire hors contexte.",
    illustration: "/patterns/candlesticks/three-black-crows.svg",
  },
] as const satisfies readonly CandlestickPattern[];

const SEARCHABLE_PATTERNS = CANDLESTICK_PATTERNS.map((pattern) => ({
  pattern,
  text: normalizeSearchText([
    pattern.name,
    pattern.id,
    ...pattern.aliases,
    pattern.description,
    pattern.category,
  ].join(" ")),
}));

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Returns a defensive readonly view of the built-in catalog. */
export function listCandlestickPatterns(): readonly CandlestickPattern[] {
  return CANDLESTICK_PATTERNS;
}

/** Resolves only known, code-owned ids; unknown ids never become asset paths. */
export function getCandlestickPattern(
  patternId: string,
): CandlestickPattern | undefined {
  return CANDLESTICK_PATTERNS.find((pattern) => pattern.id === patternId);
}

/** Search names, stable ids, aliases and short descriptions. */
export function searchCandlestickPatterns(
  options: CandlestickPatternSearchOptions = {},
): CandlestickPattern[] {
  const queryTokens = normalizeSearchText(options.query ?? "")
    .split(" ")
    .filter(Boolean);

  return SEARCHABLE_PATTERNS
    .filter(({ pattern, text }) => {
      if (options.category && options.category !== "all" && pattern.category !== options.category) {
        return false;
      }
      if (options.bias && options.bias !== "all" && pattern.bias !== options.bias) {
        return false;
      }
      return queryTokens.every((token) => text.includes(token));
    })
    .map(({ pattern }) => pattern);
}

/** Runtime guard shared by the future Zod block schema and parser. */
export function isCandlestickPatternId(value: string): boolean {
  return CANDLESTICK_PATTERNS.some((pattern) => pattern.id === value);
}

/** Keeps category definitions discoverable without duplicating their values. */
export function isCandlestickPatternCategory(
  value: string,
): value is (typeof CANDLESTICK_PATTERN_CATEGORIES)[number] {
  return (CANDLESTICK_PATTERN_CATEGORIES as readonly string[]).includes(value);
}
