/**
 * Gaïa : les 5 modèles built-in (contenu possédé par le code).
 *
 * Ils ne sont jamais persistés en base et ne sont jamais modifiables par
 * l'utilisateur. Une seule source de vérité : cette fonction sert à la fois
 * la liste des modèles, l'instanciation et le seed.
 * Ids stables en slug (tpl-...), createdAt fixe.
 */
import { newBlockId, type GaiaBlock } from "./content";

export type GaiaBuiltInTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  blocks: GaiaBlock[];
  builtIn: true;
  createdAt: string;
};

const BUILT_IN_CREATED_AT = "2026-01-01T00:00:00.000Z";

function h2(text: string): GaiaBlock {
  return { id: newBlockId(), type: "h2", text };
}

function paragraph(text: string): GaiaBlock {
  return { id: newBlockId(), type: "paragraph", text };
}

function bullet(text: string): GaiaBlock {
  return { id: newBlockId(), type: "bullet", text };
}

function todo(text: string): GaiaBlock {
  return { id: newBlockId(), type: "todo", text, checked: false };
}

function callout(
  text: string,
  tone: "info" | "tip" | "warn" | "risk",
): GaiaBlock {
  return { id: newBlockId(), type: "callout", text, tone };
}

export function builtInTemplates(): GaiaBuiltInTemplate[] {
  return [
    {
      id: "tpl-trading-idea",
      name: "Idée de trade",
      description: "Structure une hypothèse avant de risquer un dollar.",
      icon: "📈",
      blocks: [
        h2("Contexte"),
        paragraph(
          "Marché, symbole et conditions qui rendent cette idée pertinente en ce moment.",
        ),
        h2("Hypothèse"),
        paragraph(
          "Ce que je m'attends à voir arriver, et pourquoi le marché devrait le récompenser.",
        ),
        h2("Conditions d'entrée"),
        todo("Première condition"),
        todo("Deuxième condition"),
        h2("Invalidation"),
        paragraph("L'observation qui prouve que cette idée est fausse."),
        h2("Risque"),
        paragraph(
          "Taille de position, distance du stop et le R que je suis prêt à perdre.",
        ),
        h2("Scénario attendu / Scénario alternatif"),
        bullet("Chemin principal…"),
        bullet("Si invalidé…"),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-market-analysis",
      name: "Analyse de marché",
      description: "Une lecture structurée d'un marché avant l'ouverture de la session.",
      icon: "🧭",
      blocks: [
        h2("Marché / Symbole / Unité de temps / Session"),
        paragraph("par ex. XAUUSD · H1 · Londres"),
        h2("Contexte de marché"),
        paragraph("Où se situe le prix dans la structure plus large."),
        h2("Structure et liquidité"),
        paragraph(
          "Swings, ranges et les zones où des ordres peuvent attendre.",
        ),
        h2("Niveaux clés"),
        bullet("Premier niveau"),
        bullet("Deuxième niveau"),
        h2("Scénarios"),
        callout("Cas haussier : ce qui le confirme.", "tip"),
        callout("Cas baissier : ce qui le confirme.", "warn"),
        h2("Invalidation"),
        paragraph("Ma lecture est fausse si…"),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-strategy-idea",
      name: "Idée de stratégie",
      description:
        "Définis une stratégie répétable comme le playbook va la noter.",
      icon: "🛠️",
      blocks: [
        h2("Nom de la stratégie"),
        paragraph(""),
        h2("Marché et conditions"),
        paragraph("Où elle s'applique, et le régime dont elle a besoin."),
        h2("Setup et conditions d'entrée"),
        todo("Déclencheur"),
        todo("Confirmation"),
        h2("Stop loss / Take profit"),
        paragraph(
          "Où l'idée est structurellement fausse, et où elle paie.",
        ),
        h2("Gestion du risque et gestion du trade"),
        paragraph(
          "Règle de taille, règle de break-even, sorties partielles, trailing.",
        ),
        h2("Observations"),
        paragraph(""),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-trade-review",
      name: "Revue de trade",
      description: "Transforme une exécution en une leçon durable.",
      icon: "🔍",
      blocks: [
        h2("Trade"),
        paragraph(
          "Référence le trade depuis le module Trades (commande slash puis Trade).",
        ),
        h2("Contexte"),
        paragraph("Ce que le marché offrait au moment de mon entrée."),
        h2("Pourquoi je suis entré"),
        paragraph(""),
        h2("Ce qui a bien marché / Ce qui a mal tourné"),
        bullet(""),
        h2("Respect des règles"),
        callout(
          "Ai-je suivi le plan ? Chaque écart coûte plus cher que la perte elle-même.",
          "risk",
        ),
        h2("Psychologie"),
        paragraph("Émotion avant, pendant, après."),
        h2("Leçon apprise et action à mener"),
        todo("Action à mener"),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-learning-note",
      name: "Note d'apprentissage",
      description: "Consolide une leçon en tes propres mots.",
      icon: "📚",
      blocks: [
        h2("Sujet"),
        paragraph(""),
        h2("Ce que j'ai appris"),
        paragraph(""),
        h2("Concepts clés et définitions"),
        bullet(""),
        h2("Exemples"),
        paragraph(""),
        h2("Questions"),
        paragraph(""),
        h2("Comment je peux l'appliquer"),
        todo("Étape d'application"),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
  ];
}

export function findBuiltInTemplate(
  templateId: string,
): GaiaBuiltInTemplate | undefined {
  return builtInTemplates().find((t) => t.id === templateId);
}
