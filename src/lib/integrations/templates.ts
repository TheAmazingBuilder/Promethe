/**
 * v2.5 Module 9 - Message templates for Discord embeds and Telegram HTML.
 *
 * Pure renderers: structured event data in, provider payload out. Privacy
 * levels are applied here, at render time:
 *  - FULL: everything (P&L, counts, thresholds).
 *  - NO_AMOUNTS: counts and percentages stay, money amounts are dropped
 *    from the fields and redactAmountsInText() runs over every rendered
 *    string as defense in depth.
 *  - MINIMAL: event name + link only, no numbers, no details.
 *
 * Discord limits enforced: title 256, description 4096, field value 1024,
 * 25 fields max, one embed per message. Telegram uses parse_mode HTML with
 * strict escaping of < > & (never MarkdownV2).
 */
import { redactAmountsInText } from "@/lib/privacy/policy";

export type IntegrationEventType =
  | "DAILY_SUMMARY"
  | "DRAWDOWN_ALERT"
  | "PROP_ALERT"
  | "TEST";

export type PrivacyLevel = "FULL" | "NO_AMOUNTS" | "MINIMAL";

export const INTEGRATION_EVENT_TYPES: IntegrationEventType[] = [
  "DAILY_SUMMARY",
  "DRAWDOWN_ALERT",
  "PROP_ALERT",
];

export interface DailySummaryData {
  date: string;
  pnl: string;
  currency: string;
  tradeCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: string | null;
  openTrades: number;
}

export interface DrawdownAlertData {
  threshold: number;
  usedPercent: string;
  drawdownUsed: string;
  drawdownLimit: string | null;
  currency: string;
  accountName: string;
  drawdownType: string;
}

export interface PropAlertData {
  kind: "BREACHED" | "TARGET_REACHED" | "DAILY_LOSS_WARNING";
  accountName: string;
  detail: string;
}

export type IntegrationEventData =
  | { eventType: "DAILY_SUMMARY"; data: DailySummaryData }
  | { eventType: "DRAWDOWN_ALERT"; data: DrawdownAlertData }
  | { eventType: "PROP_ALERT"; data: PropAlertData }
  | { eventType: "TEST"; data: Record<string, never> };

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: DiscordEmbedField[];
  url?: string;
}

export interface DiscordPayload {
  embeds: DiscordEmbed[];
}

const COLOR_EMERALD = 0x10b981;
const COLOR_RED = 0xef4444;
const COLOR_AMBER = 0xf59e0b;
const COLOR_NEUTRAL = 0x64748b;

function trunc(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function money(amount: string, currency: string): string {
  const sign = Number(amount) > 0 ? "+" : "";
  return `${sign}${amount} ${currency}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function eventLabel(eventType: IntegrationEventType): string {
  switch (eventType) {
    case "DAILY_SUMMARY":
      return "Résumé quotidien";
    case "DRAWDOWN_ALERT":
      return "Alerte drawdown";
    case "PROP_ALERT":
      return "Alerte prop";
    case "TEST":
      return "Message de test";
  }
}

/** Minimal payload: event name + link only, no numbers, no details. */
function minimalDiscord(
  eventType: IntegrationEventType,
  appUrl: string
): DiscordPayload {
  return {
    embeds: [
      {
        title: trunc(`Promethe : ${eventLabel(eventType)}`, 256),
        description: trunc(
          "Nouvel événement dans votre journal. Ouvrez Promethe pour voir le détail.",
          4096
        ),
        color: COLOR_NEUTRAL,
        url: appUrl,
      },
    ],
  };
}

function minimalTelegram(eventType: IntegrationEventType, appUrl: string): string {
  return (
    `<b>Promethe : ${escapeHtml(eventLabel(eventType))}</b>\n` +
    `Nouvel événement dans votre journal. Ouvrez Promethe pour voir le détail.\n` +
    `<a href="${escapeHtml(appUrl)}">Ouvrir Promethe</a>`
  );
}

function renderDiscordEmbed(
  event: IntegrationEventData,
  privacy: PrivacyLevel,
  appUrl: string
): DiscordPayload {
  if (privacy === "MINIMAL") {
    return minimalDiscord(event.eventType, appUrl);
  }
  const hideAmounts = privacy === "NO_AMOUNTS";
  const clean = (s: string) =>
    hideAmounts ? redactAmountsInText(s) : s;

  if (event.eventType === "TEST") {
    return {
      embeds: [
        {
          title: "Promethe : message de test",
          description: clean(
            "Si vous lisez ce message, votre intégration fonctionne."
          ),
          color: COLOR_EMERALD,
          url: appUrl,
        },
      ],
    };
  }

  if (event.eventType === "DAILY_SUMMARY") {
    const d = event.data;
    const pnlNum = Number(d.pnl);
    const fields: DiscordEmbedField[] = [];
    if (!hideAmounts) {
      fields.push({
        name: "P&L du jour",
        value: trunc(clean(money(d.pnl, d.currency)), 1024),
        inline: true,
      });
    }
    fields.push(
      {
        name: "Trades clôturés",
        value: trunc(String(d.tradeCount), 1024),
        inline: true,
      },
      {
        name: "Gagnants / Perdants",
        value: trunc(`${d.wins} / ${d.losses}`, 1024),
        inline: true,
      },
      {
        name: "Win rate",
        value: trunc(d.winRate == null ? "n/a" : `${d.winRate} %`, 1024),
        inline: true,
      },
      {
        name: "Trades ouverts",
        value: trunc(String(d.openTrades), 1024),
        inline: true,
      }
    );
    return {
      embeds: [
        {
          title: trunc(`Promethe : résumé du ${d.date}`, 256),
          description: trunc(
            clean(
              pnlNum > 0
                ? "Journée positive."
                : pnlNum < 0
                  ? "Journée négative."
                  : "Journée neutre."
            ),
            4096
          ),
          color: pnlNum > 0 ? COLOR_EMERALD : pnlNum < 0 ? COLOR_RED : COLOR_NEUTRAL,
          fields,
          url: appUrl,
        },
      ],
    };
  }

  if (event.eventType === "DRAWDOWN_ALERT") {
    const d = event.data;
    const fields: DiscordEmbedField[] = [
      {
        name: "Seuil franchi",
        value: trunc(`${d.threshold} % du drawdown max`, 1024),
        inline: true,
      },
      {
        name: "Drawdown utilisé",
        value: trunc(`${d.usedPercent} %`, 1024),
        inline: true,
      },
      {
        name: "Compte",
        value: trunc(clean(d.accountName), 1024),
        inline: true,
      },
    ];
    if (!hideAmounts) {
      fields.push({
        name: "Drawdown actuel",
        value: trunc(
          clean(
            d.drawdownLimit == null
              ? money(d.drawdownUsed, d.currency)
              : `${money(d.drawdownUsed, d.currency)} / ${money(d.drawdownLimit, d.currency)}`
          ),
          1024
        ),
        inline: true,
      });
    }
    return {
      embeds: [
        {
          title: trunc(
            `Promethe : drawdown à ${d.usedPercent} % (${d.drawdownType === "TRAILING" ? "trailing" : "statique"})`,
            256
          ),
          description: trunc(
            clean(
              "Votre drawdown a franchi un seuil de vigilance. Vérifiez vos positions ouvertes."
            ),
            4096
          ),
          color: d.threshold >= 95 ? COLOR_RED : COLOR_AMBER,
          fields,
          url: appUrl,
        },
      ],
    };
  }

  // PROP_ALERT
  const d = event.data;
  const title =
    d.kind === "BREACHED"
      ? "Promethe : règle prop violée"
      : d.kind === "TARGET_REACHED"
        ? "Promethe : objectif prop atteint"
        : "Promethe : perte journalière proche de la limite";
  return {
    embeds: [
      {
        title: trunc(title, 256),
        description: trunc(clean(d.detail), 4096),
        color: d.kind === "BREACHED" ? COLOR_RED : COLOR_EMERALD,
        fields: [
          {
            name: "Compte",
            value: trunc(clean(d.accountName), 1024),
            inline: true,
          },
        ],
        url: appUrl,
      },
    ],
  };
}

export function renderDiscord(
  event: IntegrationEventData,
  privacy: PrivacyLevel,
  appUrl: string
): DiscordPayload {
  return renderDiscordEmbed(event, privacy, appUrl);
}

function renderTelegramText(
  event: IntegrationEventData,
  privacy: PrivacyLevel,
  appUrl: string
): string {
  if (privacy === "MINIMAL") {
    return minimalTelegram(event.eventType, appUrl);
  }
  const hideAmounts = privacy === "NO_AMOUNTS";
  const clean = (s: string) =>
    hideAmounts ? redactAmountsInText(s) : s;
  const link = `<a href="${escapeHtml(appUrl)}">Ouvrir Promethe</a>`;

  if (event.eventType === "TEST") {
    return (
      `<b>Promethe : message de test</b>\n` +
      `${escapeHtml(clean("Si vous lisez ce message, votre intégration fonctionne."))}\n` +
      link
    );
  }

  if (event.eventType === "DAILY_SUMMARY") {
    const d = event.data;
    const pnlNum = Number(d.pnl);
    const lines = [
      `<b>Promethe : résumé du ${escapeHtml(d.date)}</b>`,
      escapeHtml(
        clean(
          pnlNum > 0
            ? "Journée positive."
            : pnlNum < 0
              ? "Journée négative."
              : "Journée neutre."
        )
      ),
    ];
    if (!hideAmounts) {
      lines.push(`P&amp;L du jour : <b>${escapeHtml(clean(money(d.pnl, d.currency)))}</b>`);
    }
    lines.push(
      `Trades clôturés : ${d.tradeCount}`,
      `Gagnants / perdants : ${d.wins} / ${d.losses}`,
      `Win rate : ${d.winRate == null ? "n/a" : `${escapeHtml(d.winRate)} %`}`,
      `Trades ouverts : ${d.openTrades}`,
      link
    );
    return lines.join("\n");
  }

  if (event.eventType === "DRAWDOWN_ALERT") {
    const d = event.data;
    const lines = [
      `<b>Promethe : drawdown à ${escapeHtml(d.usedPercent)} %</b>`,
      `Seuil franchi : ${d.threshold} % du drawdown max (${d.drawdownType === "TRAILING" ? "trailing" : "statique"})`,
      `Compte : ${escapeHtml(clean(d.accountName))}`,
    ];
    if (!hideAmounts) {
      lines.push(
        `Drawdown actuel : ${escapeHtml(clean(d.drawdownLimit == null ? money(d.drawdownUsed, d.currency) : `${money(d.drawdownUsed, d.currency)} / ${money(d.drawdownLimit, d.currency)}`))}`
      );
    }
    lines.push(
      escapeHtml(clean("Vérifiez vos positions ouvertes.")),
      link
    );
    return lines.join("\n");
  }

  const d = event.data;
  const title =
    d.kind === "BREACHED"
      ? "Promethe : règle prop violée"
      : d.kind === "TARGET_REACHED"
        ? "Promethe : objectif prop atteint"
        : "Promethe : perte journalière proche de la limite";
  return [
    `<b>${escapeHtml(title)}</b>`,
    escapeHtml(clean(d.detail)),
    `Compte : ${escapeHtml(clean(d.accountName))}`,
    link,
  ].join("\n");
}

export function renderTelegram(
  event: IntegrationEventData,
  privacy: PrivacyLevel,
  appUrl: string
): string {
  return renderTelegramText(event, privacy, appUrl);
}

/** Parse a stored OutboundMessage payloadJson back into a typed event. */
export function parseOutboundPayload(
  payloadJson: string
): { event: IntegrationEventData; privacyLevel: PrivacyLevel } | null {
  try {
    const raw = JSON.parse(payloadJson) as {
      eventType?: unknown;
      privacyLevel?: unknown;
      data?: unknown;
    };
    if (typeof raw.eventType !== "string" || raw.data == null) return null;
    const privacyLevel: PrivacyLevel =
      raw.privacyLevel === "NO_AMOUNTS" || raw.privacyLevel === "MINIMAL"
        ? raw.privacyLevel
        : "FULL";
    const event = {
      eventType: raw.eventType,
      data: raw.data,
    } as IntegrationEventData;
    return { event, privacyLevel };
  } catch {
    return null;
  }
}
