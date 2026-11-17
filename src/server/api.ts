/**
 * Shared API error mapping — every route handler wraps its body with the same
 * try/catch so typed errors (unauthorized, validation, not found) map to
 * consistent envelopes and raw Prisma/provider errors NEVER reach the client.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/server/session";
import { TradeValidationError } from "@/server/trades";
import { TemplateValidationError } from "@/server/templates";
import { UploadValidationError } from "@/server/uploads";
import { ShareValidationError } from "@/server/sharing";
import { MentorValidationError } from "@/server/mentors";
import { CommentValidationError } from "@/server/comments";
import { UserValidationError } from "@/server/users";
import { InstrumentValidationError } from "@/server/instruments";
import { DashboardValidationError } from "@/server/dashboards";
import { AccessDeniedError } from "@/lib/access";
import {
  ToolsTablesMissingError,
  ToolsValidationError,
} from "@/server/tools";
import { IntegrationValidationError } from "@/server/integrations/endpoints";

type CodedError = {
  code: string;
  status: number;
};

const CODE_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_FOUND: "Compte introuvable.",
  INSTRUMENT_NOT_FOUND: "Instrument introuvable.",
  STRATEGY_NOT_FOUND: "Stratégie introuvable.",
  TAG_NOT_FOUND: "Tag introuvable.",
  CHECKLIST_NOT_FOUND: "Élément de checklist introuvable.",
  EXIT_PRICE_REQUIRED: "Un prix de sortie est requis pour clôturer un trade.",
  ALREADY_CLOSED: "Ce trade est déjà clôturé.",
  INVALID_DATE: "Date invalide.",
  TRADES_ON_ACCOUNT: "Ce compte contient des trades - archivage seulement.",
  UNSUPPORTED_TYPE: "Type de fichier non supporté (PNG, JPEG ou WebP).",
  FILE_TOO_LARGE: "Fichier trop volumineux (max 5 Mo).",
  TRADE_NOT_FOUND: "Capture rattachée à un trade introuvable.",
  INVALID_PERIOD: "Période de rapport invalide.",
  SHARE_TRADE_NOT_FOUND: "Trade introuvable - impossible de le partager.",
  // v3 Phase 5 — mentoring & comments
  ACCESS_DENIED: "Accès refusé.",
  HANDLE_INVALID: "Handle invalide (a-z, 0-9, _, 3-24 caractères).",
  HANDLE_TAKEN: "Ce handle est déjà utilisé.",
  HANDLE_REQUIRED: "Choisissez d'abord votre handle.",
  SELF_INVITE: "Vous ne pouvez pas vous inviter vous-même.",
  INVITE_ALREADY_PENDING: "Une invitation est déjà en attente pour cet email.",
  MENTOR_ALREADY_ACTIVE: "Ce mentor a déjà un accès actif.",
  TOO_MANY_PENDING: "Trop d'invitations en attente.",
  INVITE_RATE_LIMITED: "Trop d'invitations envoyées aujourd'hui.",
  INVITE_NOT_FOUND: "Invitation introuvable.",
  INVITE_NOT_PENDING: "Cette invitation a déjà été traitée.",
  INVITE_EXPIRED: "Cette invitation a expiré.",
  ACCESS_NOT_FOUND: "Accès de mentorat introuvable.",
  ACCESS_REVOKED: "Cet accès est révoqué.",
  COMMENT_NOT_FOUND: "Commentaire introuvable.",
  COMMENT_DELETED: "Ce commentaire est supprimé.",
  COMMENT_RATE_LIMITED: "Trop de commentaires - patientez quelques instants.",
  PARENT_INVALID: "Commentaire parent invalide.",
  MENTION_INVALID: "Mention impossible : cette personne n'a pas accès à ce trade.",
  // v1 Phase 7 — instruments personnalisés
  INSTRUMENT_DUPLICATE: "Vous avez déjà un instrument avec ce symbole.",
  INSTRUMENT_PIP_INVALID: "Taille de pip invalide (ex. 0.0001 ou 0.01 pour XAUUSD).",
  INSTRUMENT_HAS_TRADES: "Des trades référencent cet instrument - suppression impossible.",
  // v2.5 Module 4 — productivity (custom fields, bulk edits)
  CUSTOM_FIELDS_INVALID: "Certains champs personnalisés sont invalides.",
  TOO_MANY_CUSTOM_FIELDS: "Limite de 30 champs personnalisés atteinte.",
  DASHBOARD_NOT_FOUND: "Dashboard not found.",
  WIDGET_NOT_FOUND: "Widget not found.",
  TOO_MANY_DASHBOARDS: "Dashboard limit reached (max 8).",
  LAST_DASHBOARD: "The last dashboard cannot be deleted.",
  TOO_MANY_WIDGETS: "Widget limit reached for this dashboard (max 24).",
  UNKNOWN_WIDGET_TYPE: "Unknown widget type.",
  INVALID_CONFIG: "Invalid widget configuration.",
  TEMPLATE_NOT_FOUND: "Template not found.",
  IMPORT_TOO_LARGE: "Import file too large (max 256 KB).",
  IMPORT_INVALID_JSON: "Import file is not valid JSON.",
  METRIC_NOT_FOUND: "Custom metric not found.",
  TOO_MANY_METRICS: "Custom metric limit reached (max 50).",
  FORMULA_INVALID: "Invalid formula expression.",
  // v2.5 Module 5 — trading tools
  TOOLS_TABLES_MISSING:
    "Les tables des outils n'existent pas encore en base. Lancez `npx prisma db push` sur votre PC puis rechargez la page.",
  FX_RATE_SAME_CURRENCY: "La devise de base et la devise de cotation doivent différer.",
  FX_RATE_DUPLICATE: "Un taux existe déjà pour cette paire.",
  EXIT_PLAN_NOT_FOUND: "Plan de sortie introuvable.",
  EXIT_PLAN_INVALID: "Les paliers doivent totaliser 100 % avec des cibles positives.",
  // v2.5 Module 9 — Discord / Telegram integrations
  ENCRYPTION_KEY_MISSING:
    "La clé de chiffrement des intégrations n'est pas configurée. Définissez INTEGRATION_ENCRYPTION_KEY sur le serveur.",
  ENCRYPTION_KEY_INVALID:
    "INTEGRATION_ENCRYPTION_KEY est invalide (32 octets, hex ou base64).",
  INVALID_ENDPOINT_TYPE: "Type d'intégration invalide.",
  INVALID_LABEL: "Nom invalide (1 à 60 caractères).",
  TOO_MANY_ENDPOINTS: "Limite de 10 intégrations atteinte.",
  INVALID_WEBHOOK_URL:
    "URL de webhook Discord invalide (format attendu : https://discord.com/api/webhooks/<id>/<token>).",
  WEBHOOK_NOT_HTTPS: "L'URL du webhook doit commencer par https://.",
  WEBHOOK_HOST_NOT_ALLOWED:
    "Hôte non autorisé : seuls discord.com et discordapp.com sont acceptés.",
  INVALID_TELEGRAM_TOKEN:
    "Token de bot Telegram invalide (format attendu : <id>:<jeton>).",
  INVALID_CHAT_ID:
    "Identifiant de chat invalide (nombre, ou @nom de canal).",
  INVALID_QUIET_HOURS: "Heures calmes invalides (format HH:mm).",
  INVALID_PRIVACY_LEVEL: "Niveau de confidentialité invalide.",
  INVALID_EVENT_TYPE: "Type d'événement invalide.",
  INVALID_VALUE: "Valeur invalide.",
  ENDPOINT_NOT_FOUND: "Intégration introuvable.",
  SUBSCRIPTION_NOT_FOUND: "Abonnement introuvable.",
  ENDPOINT_DISABLED: "Cette intégration est désactivée.",
  TELEGRAM_API_ERROR:
    "Telegram n'a pas répondu ou le token est invalide.",
  TEST_FAILED: "Le message de test n'a pas pu être envoyé.",
};

function isCoded(error: unknown): error is CodedError {
  return (
    error instanceof TradeValidationError ||
    error instanceof TemplateValidationError ||
    error instanceof UploadValidationError ||
    error instanceof ShareValidationError ||
    error instanceof MentorValidationError ||
    error instanceof CommentValidationError ||
    error instanceof UserValidationError ||
    error instanceof InstrumentValidationError ||
    error instanceof DashboardValidationError ||
    error instanceof ToolsValidationError ||
    error instanceof ToolsTablesMissingError ||
    error instanceof IntegrationValidationError ||
    error instanceof AccessDeniedError
  );
}

export function apiError(error: unknown, route: string): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Session absente ou expirée." },
      { status: 401 }
    );
  }
  if (isCoded(error)) {
    return NextResponse.json(
      {
        error: error.code,
        message: CODE_MESSAGES[error.code] ?? "Requête invalide.",
      },
      { status: error.status }
    );
  }
  console.error(`[api/${route}] failed:`, error);
  return NextResponse.json(
    { error: "INTERNAL", message: "Une erreur est survenue. Réessayez." },
    { status: 500 }
  );
}
