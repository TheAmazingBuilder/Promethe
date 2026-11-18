/**
 * Gaïa : les 5 modèles built-in (contenu possédé par le code).
 *
 * Ils ne sont jamais persistés en base et ne sont jamais modifiables par
 * l'utilisateur. Une seule source de vérité : cette fonction sert à la fois
 * la liste des modèles et l'instanciation.
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
      name: "Trade idea",
      description: "Structure a hypothesis before risking a dollar.",
      icon: "📈",
      blocks: [
        h2("Context"),
        paragraph(
          "Market, symbol and conditions that make this idea relevant right now.",
        ),
        h2("Hypothesis"),
        paragraph(
          "What I expect to happen, and why the market should reward it.",
        ),
        h2("Entry conditions"),
        todo("First condition"),
        todo("Second condition"),
        h2("Invalidation"),
        paragraph("The observation that proves this idea wrong."),
        h2("Risk"),
        paragraph(
          "Position size, stop distance and the R I am willing to lose.",
        ),
        h2("Expected scenario / Alternative scenario"),
        bullet("Main path…"),
        bullet("If invalidated…"),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-market-analysis",
      name: "Market analysis",
      description: "A structured read of a market before the session opens.",
      icon: "🧭",
      blocks: [
        h2("Market / Symbol / Timeframe / Session"),
        paragraph("e.g. XAUUSD · H1 · London"),
        h2("Market context"),
        paragraph("Where price sits in the larger structure."),
        h2("Structure and liquidity"),
        paragraph(
          "Swings, ranges and the zones where orders may be waiting.",
        ),
        h2("Key levels"),
        bullet("First level"),
        bullet("Second level"),
        h2("Scenarios"),
        callout("Bullish case: what confirms it.", "tip"),
        callout("Bearish case: what confirms it.", "warn"),
        h2("Invalidation"),
        paragraph("My read is wrong if…"),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-strategy-idea",
      name: "Strategy idea",
      description:
        "Define a repeatable strategy the way the playbook will score it.",
      icon: "🛠️",
      blocks: [
        h2("Strategy name"),
        paragraph(""),
        h2("Market and conditions"),
        paragraph("Where it applies, and the regime it needs."),
        h2("Setup and entry conditions"),
        todo("Trigger"),
        todo("Confirmation"),
        h2("Stop loss / Take profit"),
        paragraph(
          "Where the idea is structurally wrong, and where it pays.",
        ),
        h2("Risk management and trade management"),
        paragraph(
          "Sizing rule, break-even rule, partial exits, trailing.",
        ),
        h2("Observations"),
        paragraph(""),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-trade-review",
      name: "Trade review",
      description: "Turn an execution into a lasting lesson.",
      icon: "🔍",
      blocks: [
        h2("Trade"),
        paragraph(
          "Reference the trade from the Trades module (slash command, then Trade).",
        ),
        h2("Context"),
        paragraph("What the market offered at the moment of my entry."),
        h2("Why I entered"),
        paragraph(""),
        h2("What went well / What went wrong"),
        bullet(""),
        h2("Rule adherence"),
        callout(
          "Did I follow the plan? Every deviation costs more than the loss itself.",
          "risk",
        ),
        h2("Psychology"),
        paragraph("Emotion before, during, after."),
        h2("Lesson learned and action to take"),
        todo("Action to take"),
      ],
      builtIn: true,
      createdAt: BUILT_IN_CREATED_AT,
    },
    {
      id: "tpl-learning-note",
      name: "Learning note",
      description: "Consolidate a lesson in your own words.",
      icon: "📚",
      blocks: [
        h2("Topic"),
        paragraph(""),
        h2("What I learned"),
        paragraph(""),
        h2("Key concepts and definitions"),
        bullet(""),
        h2("Examples"),
        paragraph(""),
        h2("Questions"),
        paragraph(""),
        h2("How I can apply it"),
        todo("Application step"),
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
