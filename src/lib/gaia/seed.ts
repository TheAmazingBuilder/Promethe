/**
 * Gaïa : seed paresseux du workspace de démo.
 *
 * Déclenché par chaque méthode du serveur Gaïa : si l'utilisateur a déjà
 * au moins un dossier, rien ne se passe. Sinon le workspace démo complet
 * est inséré : 7 dossiers, 10 tags, 9 notes (dont une dans la corbeille).
 *
 * Les blocs `ref` du seed pointent vers de vraies entités de l'utilisateur
 * quand elles existent ; sinon le bloc ref est remplacé par un paragraphe
 * vide. Les horodatages sont relatifs à l'exécution (jours/heures en arrière).
 * Les modèles built-in ne sont pas seedés en base : ils vivent dans le code.
 */
import { db } from "@/lib/db";
import type { GaiaBlock, GaiaBlockType, GaiaCalloutTone } from "./content";

function daysAgoIso(days: number, hourOffset = 0): Date {
  return new Date(Date.now() - days * 86_400_000 - hourOffset * 3_600_000);
}

let seedBlockCounter = 0;

function seedBlockId(): string {
  return `nb-seed-${(seedBlockCounter++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function b(
  type: GaiaBlockType,
  text = "",
  extra?: { checked?: boolean; tone?: GaiaCalloutTone; rows?: string[][] },
): GaiaBlock {
  const block: GaiaBlock = { id: seedBlockId(), type, text };
  if (extra?.checked !== undefined) block.checked = extra.checked;
  if (extra?.tone !== undefined) block.tone = extra.tone;
  if (extra?.rows !== undefined) block.rows = extra.rows;
  return block;
}

function refBlock(kind: "TRADE" | "STRATEGY" | "SETUP" | "SYMBOL", id: string | undefined): GaiaBlock {
  if (!id) return b("paragraph", "");
  return { id: seedBlockId(), type: "ref", text: "", ref: { kind, id } };
}

type SeedContext = {
  losingTradeId?: string;
  winningTradeId?: string;
  strategyId?: string;
  setupId?: string;
  xauusdInstrumentId?: string;
};

async function buildSeedContext(userId: string): Promise<SeedContext> {
  const [trades, strategies, instruments] = await Promise.all([
    db.trade.findMany({ where: { userId } }).catch(() => []),
    db.strategy.findMany({ where: { userId } }).catch(() => []),
    db.instrument
      .findMany({ where: { OR: [{ userId }, { userId: null }] } })
      .catch(() => []),
  ]);
  const rOf = (t: { rMultiple: unknown }): number => {
    if (t.rMultiple === null || t.rMultiple === undefined) return 0;
    return Number(String(t.rMultiple));
  };
  const closed = trades.filter((t) => t.status === "CLOSED");
  const losingTrade =
    closed.find((t) => rOf(t) < -0.5) ?? closed[0];
  const winningTrade =
    closed.find((t) => rOf(t) >= 1.5) ?? closed[1] ?? closed[0];
  const setupId = trades.find((t) => t.setupType)?.setupType ?? undefined;
  const xauusdInstrumentId =
    instruments.find((i) => i.symbol === "XAUUSD")?.id ??
    instruments[0]?.id;
  return {
    losingTradeId: losingTrade ? String(losingTrade.id) : undefined,
    winningTradeId: winningTrade ? String(winningTrade.id) : undefined,
    strategyId: strategies[0]?.id,
    setupId: setupId ?? undefined,
    xauusdInstrumentId,
  };
}

const FOLDER_DEFS: { name: string; ageDays: number }[] = [
  { name: "Stratégies", ageDays: 24 },
  { name: "Analyse de marché", ageDays: 24 },
  { name: "Psychologie", ageDays: 23 },
  { name: "Recherche", ageDays: 21 },
  { name: "Idées de trades", ageDays: 20 },
  { name: "Checklists", ageDays: 19 },
  { name: "Apprentissage", ageDays: 18 },
];

const TAG_DEFS = [
  "XAUUSD",
  "NASDAQ",
  "Forex",
  "Breakout",
  "Liquidity",
  "Psychology",
  "RiskManagement",
  "LondonSession",
  "CPI",
  "StrategyIdea",
];

type SeedNoteDef = {
  title: string;
  icon: string;
  folder: string | null;
  tags: string[];
  favorite: boolean;
  templateId: string | null;
  createdDays: number;
  createdHours: number;
  updatedDays: number;
  updatedHours: number;
  viewedDays: number | null;
  viewedHours: number;
  deletedDays: number | null;
  deletedHours: number;
  blocks: GaiaBlock[];
};

function noteDefs(ctx: SeedContext): SeedNoteDef[] {
  return [
    {
      title: "Breakout Londres sur XAUUSD : observations",
      icon: "📈",
      folder: "Analyse de marché",
      tags: ["XAUUSD", "LondonSession", "Breakout"],
      favorite: true,
      templateId: null,
      createdDays: 16,
      createdHours: 2,
      updatedDays: 1,
      updatedHours: 3,
      viewedDays: 1,
      viewedHours: 3,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b("h2", "Comportement de la session"),
        b(
          "paragraph",
          "L'or a tendance à balayer le range asiatique dans les 15 premières minutes de Londres, puis à tourner. Le balayage n'est tradable que si la reprise tient sur la clôture 5m, sinon c'est une continuation, pas un retournement.",
        ),
        b(
          "paragraph",
          "Trois semaines à journaliser la même fenêtre : **11 balayages qualifiés, 7 reprises**. L'avantage est dans la reprise, jamais dans le balayage lui-même.",
        ),
        b("h2", "Checklist de qualification"),
        b("todo", "Range asiatique défini (au moins 6 bougies, plus hauts et plus bas nets)", { checked: true }),
        b("todo", "Balayage avec momentum, pas une dérive lente", { checked: true }),
        b("todo", "Clôture 5m de reprise à l'intérieur du range", { checked: true }),
        b("todo", "Aucune publication à fort impact dans la fenêtre", { checked: false }),
        b("h2", "Journal des observations"),
        b("table", "", {
          rows: [
            ["Condition", "Observation", "Résultat"],
            ["Ouverture de Londres et range net", "Balayage de liquidité puis reprise", "Valide"],
            ["Ouverture de New York, pas de range", "Pas de confirmation, range médian agité", "Invalide"],
            ["Jour de CPI", "Balayage ignoré, spreads élargis", "Ignoré"],
          ],
        }),
        b(
          "callout",
          "Le balayage est un appât. La reprise est le setup, attends-la à chaque fois.",
          { tone: "warn" },
        ),
      ],
    },
    {
      title: "Pourquoi je suis entré trop tôt",
      icon: "🧠",
      folder: "Psychologie",
      tags: ["Psychology", "RiskManagement"],
      favorite: true,
      templateId: null,
      createdDays: 9,
      createdHours: 5,
      updatedDays: 2,
      updatedHours: 1,
      viewedDays: 2,
      viewedHours: 1,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b(
          "paragraph",
          "Le schéma que je répète : je vois le setup se former et j'anticipe la confirmation parce que j'ai peur de le rater. L'entrée semble courageuse sur le moment et coûte toujours plus cher que le trade manqué n'aurait coûté.",
        ),
        b("quote", "Rater un trade ne coûte rien. Entrer trop tôt coûte le R entier."),
        b(
          "callout",
          "Règle : bougie de confirmation ou rien. S'il est déjà parti sans moi, ce n'était jamais mon trade.",
          { tone: "risk" },
        ),
        b("h2", "Preuves tirées du journal"),
        b(
          "paragraph",
          "Le trade perdant ci-dessous est le troisième devancé ce mois-ci. Même émotion avant l'entrée, même sentiment à la sortie.",
        ),
        refBlock("TRADE", ctx.losingTradeId),
        refBlock("STRATEGY", ctx.strategyId),
        b("h2", "Actions à mener"),
        b("todo", "Écrire la règle de confirmation en haut de la checklist pré-session", { checked: true }),
        b("todo", "Journaliser chaque entrée sans confirmation, pendant 10 sessions", { checked: false }),
      ],
    },
    {
      title: "Recherche sur les balayages de liquidité",
      icon: "🔬",
      folder: "Recherche",
      tags: ["Liquidity", "XAUUSD"],
      favorite: false,
      templateId: null,
      createdDays: 12,
      createdHours: 4,
      updatedDays: 4,
      updatedHours: 2,
      viewedDays: 4,
      viewedHours: 2,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b("h2", "Définition de travail"),
        b(
          "paragraph",
          "Un balayage de liquidité est une poussée au-delà d'un plus haut ou plus bas visible qui ne tient pas, conçue pour remplir des ordres plus gros. Il échoue comme breakout en une à trois bougies.",
        ),
        b("h2", "Ce qui le rend exploitable"),
        b("numbered", "Un niveau antérieur net que tout le monde peut voir"),
        b("numbered", "Du momentum vers le niveau, pas une dérive lente"),
        b("numbered", "Un rejet rapide, la bougie de reprise est le signal"),
        b("h2", "Ce que ce n'est PAS"),
        b("bullet", "Un retournement garanti, les balayages échouent constamment en tendance"),
        b("bullet", "Une raison de sauter la bougie de confirmation"),
        b(
          "callout",
          "Contre-tendance par nature. Évalue-le contre la structure de l'unité de temps supérieure avant toute chose.",
          { tone: "info" },
        ),
      ],
    },
    {
      title: "Étude des réactions au CPI",
      icon: "📊",
      folder: "Recherche",
      tags: ["CPI", "XAUUSD", "Forex"],
      favorite: false,
      templateId: null,
      createdDays: 7,
      createdHours: 6,
      updatedDays: 5,
      updatedHours: 4,
      viewedDays: null,
      viewedHours: 0,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b(
          "paragraph",
          "J'étudie comment l'or réagit aux publications du CPI américain. L'objectif n'est pas de trader la publication, mais de comprendre le range post-publication pour trader le deuxième mouvement en sécurité.",
        ),
        b("h2", "Observations"),
        b("bullet", "Le premier mouvement est du bruit, les spreads s'élargissent et les deux côtés se font piéger"),
        b("bullet", "Le mouvement tradable est en général la deuxième impulsion, 5 à 15 minutes après la publication"),
        b("bullet", "Le range du pic initial devient étonnamment souvent le plus haut ou le plus bas du jour"),
        b("callout", "Aucune entrée dans les cinq premières minutes. Jamais.", { tone: "risk" }),
      ],
    },
    {
      title: "Nouvelle idée de stratégie : fondu du range d'ouverture de New York",
      icon: "💡",
      folder: "Idées de trades",
      tags: ["StrategyIdea", "NASDAQ"],
      favorite: true,
      templateId: "tpl-strategy-idea",
      createdDays: 3,
      createdHours: 7,
      updatedDays: 0,
      updatedHours: 5,
      viewedDays: 0,
      viewedHours: 5,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b("h2", "Hypothèse"),
        b(
          "paragraph",
          "Quand le range d'ouverture de New York est anormalement étroit (moins de 0,3 x ATR(14) H1), le premier breakout échoue souvent et le prix revient à travers le range. Fonde le breakout raté en visant le côté opposé.",
        ),
        refBlock("SETUP", ctx.setupId),
        b("h2", "Conditions d'entrée"),
        b("todo", "Largeur du range inférieure à 0,3 x ATR(14)", { checked: false }),
        b("todo", "La bougie de breakout clôture à l'intérieur du range", { checked: false }),
        b("todo", "Aucune publication de premier plan dans l'heure qui suit", { checked: false }),
        b("h2", "Invalidation"),
        b("paragraph", "Une clôture au-delà du range avec un volume en hausse tue l'idée de fondu pour la journée."),
        refBlock("SYMBOL", ctx.xauusdInstrumentId),
        b(
          "callout",
          "Teste au moins 30 occurrences avant que cette idée passe dans le playbook.",
          { tone: "tip" },
        ),
      ],
    },
    {
      title: "Checklist pré-session",
      icon: "✅",
      folder: "Checklists",
      tags: ["RiskManagement"],
      favorite: false,
      templateId: null,
      createdDays: 18,
      createdHours: 1,
      updatedDays: 0,
      updatedHours: 8,
      viewedDays: 0,
      viewedHours: 8,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b(
          "paragraph",
          "À faire avant chaque session. Cinq minutes ici coûtent moins cher que n'importe quelle violation.",
        ),
        b("h2", "Avant l'ouverture"),
        b("todo", "Limite de perte journalière relue à voix haute", { checked: true }),
        b("todo", "Calendrier économique vérifié pour la fenêtre de session", { checked: true }),
        b("todo", "Biais de l'unité de temps supérieure écrit en une phrase", { checked: false }),
        b("todo", "Maximum 2 trades prévus, compte-les", { checked: false }),
        b(
          "callout",
          "Si la checklist ne peut pas être terminée, la session ne commence pas.",
          { tone: "warn" },
        ),
      ],
    },
    {
      title: "Taille de position : mes notes",
      icon: "📚",
      folder: "Apprentissage",
      tags: ["RiskManagement", "Forex"],
      favorite: false,
      templateId: null,
      createdDays: 6,
      createdHours: 3,
      updatedDays: 6,
      updatedHours: 1,
      viewedDays: 6,
      viewedHours: 1,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b(
          "paragraph",
          "Consolidation personnelle de la leçon sur la taille de position, écrite avec mes propres mots pour que ça reste.",
        ),
        b("h2", "Le calcul de base"),
        b(
          "paragraph",
          "Montant du risque = solde x risque en %. Taille de position = montant du risque divisé par (distance du stop x valeur par unité). La distance du stop est DONNÉE par la structure, la taille s'y adapte, jamais l'inverse.",
        ),
        b("h2", "Ce que je rate encore"),
        b("bullet", "Élargir le stop pour garder la taille, c'est nier le risque, pas dimensionner"),
        b("bullet", "Oublier le spread sur les instruments larges comme l'or"),
        b("h2", "Application"),
        b("todo", "Calculer la taille à la main sur les 5 prochains trades avant de vérifier avec le calculateur", {
          checked: false,
        }),
      ],
    },
    {
      title: "Revue hebdo : ce que disent les données",
      icon: "🧾",
      folder: "Stratégies",
      tags: ["XAUUSD", "Breakout"],
      favorite: false,
      templateId: null,
      createdDays: 2,
      createdHours: 6,
      updatedDays: 0,
      updatedHours: 2,
      viewedDays: 0,
      viewedHours: 2,
      deletedDays: null,
      deletedHours: 0,
      blocks: [
        b(
          "paragraph",
          "Agrégé depuis la dernière revue du journal : la stratégie de breakout paie quand le range est qualifié, et saigne quand je la force dans un range agité. La solution est un filtre, pas une nouvelle stratégie.",
        ),
        refBlock("TRADE", ctx.winningTradeId),
        b("h2", "Décisions"),
        b("numbered", "Ajouter le filtre ATR à la définition de la stratégie"),
        b("numbered", "Aucun trade de breakout les jours de news à fort impact"),
        b("numbered", "Requalifier chaque breakout forcé en violation"),
      ],
    },
    {
      title: "Idée impulsive : scalper l'ouverture",
      icon: "🗑️",
      folder: null,
      tags: [],
      favorite: false,
      templateId: null,
      createdDays: 3,
      createdHours: 2,
      updatedDays: 3,
      updatedHours: 1,
      viewedDays: null,
      viewedHours: 0,
      deletedDays: 2,
      deletedHours: 4,
      blocks: [
        b(
          "paragraph",
          "Idée impulsive écrite en pleine session, supprimée après relecture, gardée dans la corbeille comme rappel.",
        ),
      ],
    },
  ];
}

/**
 * Seed paresseux : ne fait rien si l'utilisateur a déjà au moins un dossier.
 * Idempotent par construction (déclenché uniquement sur un workspace vide).
 */
export async function ensureGaiaSeed(userId: string): Promise<void> {
  const existingFolders = await db.noteFolder.count({ where: { userId } });
  if (existingFolders > 0) return;

  const ctx = await buildSeedContext(userId);

  const folderIds = new Map<string, string>();
  for (const def of FOLDER_DEFS) {
    const created = await db.noteFolder.create({
      data: {
        userId,
        name: def.name,
        createdAt: daysAgoIso(def.ageDays),
        updatedAt: daysAgoIso(def.ageDays),
      },
    });
    folderIds.set(def.name, created.id);
  }

  const tagIds = new Map<string, string>();
  for (const name of TAG_DEFS) {
    const created = await db.noteTag.create({
      data: { userId, name },
    });
    tagIds.set(name, created.id);
  }

  for (const def of noteDefs(ctx)) {
    await db.note.create({
      data: {
        userId,
        title: def.title,
        icon: def.icon,
        folderId: def.folder ? folderIds.get(def.folder) ?? null : null,
        tagIds: JSON.stringify(
          def.tags
            .map((name) => tagIds.get(name))
            .filter((id): id is string => id !== undefined),
        ),
        favorite: def.favorite,
        templateId: def.templateId,
        blocks: JSON.stringify(def.blocks),
        createdAt: daysAgoIso(def.createdDays, def.createdHours),
        updatedAt: daysAgoIso(def.updatedDays, def.updatedHours),
        lastViewedAt:
          def.viewedDays === null
            ? null
            : daysAgoIso(def.viewedDays, def.viewedHours),
        deletedAt:
          def.deletedDays === null
            ? null
            : daysAgoIso(def.deletedDays, def.deletedHours),
      },
    });
  }
}
