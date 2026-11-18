/**
 * v2.5 Module 9 - Endpoint / subscription service (server).
 *
 * Secrets are validated for shape, encrypted with the master key, and never
 * returned: list/get DTOs carry only secretHint. Creating an endpoint
 * auto-creates its 3 subscriptions (all events, FULL, enabled) so the user
 * only has to tune them afterwards.
 */
import { db } from "@/lib/db";
import {
  encryptSecret,
  hasIntegrationEncryptionKey,
  IntegrationCryptoError,
} from "@/lib/integrations/crypto";
import {
  isValidQuietHours,
  validateDiscordWebhookUrl,
  validateTelegramChatId,
  validateTelegramToken,
} from "@/lib/integrations/validation";
import {
  INTEGRATION_EVENT_TYPES,
  type IntegrationEventType,
  type PrivacyLevel,
} from "@/lib/integrations/templates";

export class IntegrationValidationError extends Error {
  readonly code: string;
  readonly status = 422;
  constructor(code: string) {
    super(code);
    this.name = "IntegrationValidationError";
    this.code = code;
  }
}

const MAX_ENDPOINTS_PER_USER = 10;

export type EndpointType = "DISCORD_WEBHOOK" | "TELEGRAM_BOT";

export interface EndpointDTO {
  id: string;
  type: EndpointType;
  label: string;
  secretHint: string;
  chatId: string | null;
  isEnabled: boolean;
  consecutiveFailures: number;
  health: "OK" | "ERROR" | "DISABLED";
  lastErrorAt: string | null;
  lastSentAt: string | null;
  createdAt: string;
}

export interface SubscriptionDTO {
  id: string;
  endpointId: string;
  eventType: IntegrationEventType;
  privacyLevel: PrivacyLevel;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  isEnabled: boolean;
}

export interface OutboundMessageDTO {
  id: string;
  endpointId: string;
  endpointLabel: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface IntegrationsOverview {
  encryptionConfigured: boolean;
  endpoints: EndpointDTO[];
  subscriptions: SubscriptionDTO[];
  messages: OutboundMessageDTO[];
}

function toEndpointDTO(row: {
  id: string;
  type: string;
  label: string;
  secretHint: string;
  chatId: string | null;
  isEnabled: boolean;
  consecutiveFailures: number;
  lastErrorAt: Date | null;
  lastSentAt: Date | null;
  createdAt: Date;
}): EndpointDTO {
  return {
    id: row.id,
    type: row.type as EndpointType,
    label: row.label,
    secretHint: row.secretHint,
    chatId: row.chatId,
    isEnabled: row.isEnabled,
    consecutiveFailures: row.consecutiveFailures,
    health: !row.isEnabled
      ? "DISABLED"
      : row.consecutiveFailures > 0
        ? "ERROR"
        : "OK",
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listIntegrations(
  userId: string
): Promise<IntegrationsOverview> {
  const [endpoints, subscriptions, messages] = await Promise.all([
    db.integrationEndpoint.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
    db.integrationSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
    db.outboundMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { endpoint: { select: { label: true } } },
    }),
  ]);
  return {
    encryptionConfigured: hasIntegrationEncryptionKey(),
    endpoints: endpoints.map(toEndpointDTO),
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      endpointId: s.endpointId,
      eventType: s.eventType as IntegrationEventType,
      privacyLevel: s.privacyLevel as PrivacyLevel,
      quietHoursStart: s.quietHoursStart,
      quietHoursEnd: s.quietHoursEnd,
      isEnabled: s.isEnabled,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      endpointId: m.endpointId,
      endpointLabel: m.endpoint.label,
      eventType: m.eventType,
      status: m.status,
      attempts: m.attempts,
      lastError: m.lastError,
      createdAt: m.createdAt.toISOString(),
      sentAt: m.sentAt?.toISOString() ?? null,
    })),
  };
}

export interface CreateEndpointInput {
  type?: unknown;
  label?: unknown;
  secret?: unknown;
  chatId?: unknown;
}

export async function createEndpoint(
  userId: string,
  input: CreateEndpointInput
): Promise<EndpointDTO> {
  if (input.type !== "DISCORD_WEBHOOK" && input.type !== "TELEGRAM_BOT") {
    throw new IntegrationValidationError("INVALID_ENDPOINT_TYPE");
  }
  const label =
    typeof input.label === "string" ? input.label.trim() : "";
  if (label === "" || label.length > 60) {
    throw new IntegrationValidationError("INVALID_LABEL");
  }
  const count = await db.integrationEndpoint.count({ where: { userId } });
  if (count >= MAX_ENDPOINTS_PER_USER) {
    throw new IntegrationValidationError("TOO_MANY_ENDPOINTS");
  }

  let secretValue: string;
  let secretHint: string;
  let chatId: string | null = null;
  if (input.type === "DISCORD_WEBHOOK") {
    const checked = validateDiscordWebhookUrl(input.secret);
    if (!checked.ok) throw new IntegrationValidationError(checked.code);
    secretValue = checked.value;
    secretHint = "discord.com";
  } else {
    const checked = validateTelegramToken(input.secret);
    if (!checked.ok) throw new IntegrationValidationError(checked.code);
    secretValue = checked.value;
    secretHint = `••••${checked.value.slice(-4)}`;
    const chatChecked = validateTelegramChatId(input.chatId);
    if (!chatChecked.ok) {
      throw new IntegrationValidationError(chatChecked.code);
    }
    chatId = chatChecked.value;
  }

  let secretEncrypted: string;
  try {
    secretEncrypted = encryptSecret(secretValue);
  } catch (error) {
    if (error instanceof IntegrationCryptoError) {
      throw new IntegrationValidationError(error.code);
    }
    throw error;
  }

  const endpoint = await db.integrationEndpoint.create({
    data: {
      userId,
      type: input.type,
      label,
      secretEncrypted,
      secretHint,
      chatId,
    },
  });
  // Default subscriptions: all 3 events, FULL privacy, enabled.
  await db.integrationSubscription.createMany({
    data: INTEGRATION_EVENT_TYPES.map((eventType) => ({
      userId,
      endpointId: endpoint.id,
      eventType,
      privacyLevel: "FULL",
      isEnabled: true,
    })),
  });
  return toEndpointDTO(endpoint);
}

export interface UpdateEndpointInput {
  label?: unknown;
  isEnabled?: unknown;
  chatId?: unknown;
  secret?: unknown;
}

export async function updateEndpoint(
  userId: string,
  id: string,
  input: UpdateEndpointInput
): Promise<EndpointDTO> {
  const current = await db.integrationEndpoint.findFirst({
    where: { id, userId },
  });
  if (!current) throw new IntegrationValidationError("ENDPOINT_NOT_FOUND");

  const data: {
    label?: string;
    isEnabled?: boolean;
    chatId?: string | null;
    secretEncrypted?: string;
    secretHint?: string;
    consecutiveFailures?: number;
  } = {};
  if (input.label !== undefined) {
    const label = typeof input.label === "string" ? input.label.trim() : "";
    if (label === "" || label.length > 60) {
      throw new IntegrationValidationError("INVALID_LABEL");
    }
    data.label = label;
  }
  if (input.isEnabled !== undefined) {
    if (typeof input.isEnabled !== "boolean") {
      throw new IntegrationValidationError("INVALID_VALUE");
    }
    data.isEnabled = input.isEnabled;
    // Re-enabling clears the failure streak.
    if (input.isEnabled) data.consecutiveFailures = 0;
  }
  if (input.chatId !== undefined) {
    if (current.type !== "TELEGRAM_BOT") {
      throw new IntegrationValidationError("INVALID_VALUE");
    }
    const checked = validateTelegramChatId(input.chatId);
    if (!checked.ok) throw new IntegrationValidationError(checked.code);
    data.chatId = checked.value;
  }
  if (input.secret !== undefined) {
    if (current.type === "DISCORD_WEBHOOK") {
      const checked = validateDiscordWebhookUrl(input.secret);
      if (!checked.ok) throw new IntegrationValidationError(checked.code);
      try {
        data.secretEncrypted = encryptSecret(checked.value);
      } catch (error) {
        if (error instanceof IntegrationCryptoError) {
          throw new IntegrationValidationError(error.code);
        }
        throw error;
      }
      data.secretHint = "discord.com";
    } else {
      const checked = validateTelegramToken(input.secret);
      if (!checked.ok) throw new IntegrationValidationError(checked.code);
      try {
        data.secretEncrypted = encryptSecret(checked.value);
      } catch (error) {
        if (error instanceof IntegrationCryptoError) {
          throw new IntegrationValidationError(error.code);
        }
        throw error;
      }
      data.secretHint = `••••${checked.value.slice(-4)}`;
    }
  }

  const updated = await db.integrationEndpoint.update({
    where: { id: current.id },
    data,
  });
  return toEndpointDTO(updated);
}

export async function deleteEndpoint(
  userId: string,
  id: string
): Promise<boolean> {
  const deleted = await db.integrationEndpoint.deleteMany({
    where: { id, userId },
  });
  return deleted.count > 0;
}

export interface UpdateSubscriptionInput {
  privacyLevel?: unknown;
  quietHoursStart?: unknown;
  quietHoursEnd?: unknown;
  isEnabled?: unknown;
}

export async function updateSubscription(
  userId: string,
  endpointId: string,
  eventType: string,
  input: UpdateSubscriptionInput
): Promise<SubscriptionDTO> {
  if (
    !(INTEGRATION_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    throw new IntegrationValidationError("INVALID_EVENT_TYPE");
  }
  const current = await db.integrationSubscription.findFirst({
    where: { userId, endpointId, eventType },
  });
  if (!current) {
    throw new IntegrationValidationError("SUBSCRIPTION_NOT_FOUND");
  }
  const data: {
    privacyLevel?: string;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    isEnabled?: boolean;
  } = {};
  if (input.privacyLevel !== undefined) {
    if (
      input.privacyLevel !== "FULL" &&
      input.privacyLevel !== "NO_AMOUNTS" &&
      input.privacyLevel !== "MINIMAL"
    ) {
      throw new IntegrationValidationError("INVALID_PRIVACY_LEVEL");
    }
    data.privacyLevel = input.privacyLevel;
  }
  if (input.quietHoursStart !== undefined) {
    if (!isValidQuietHours(input.quietHoursStart)) {
      throw new IntegrationValidationError("INVALID_QUIET_HOURS");
    }
    data.quietHoursStart =
      input.quietHoursStart === "" ? null : (input.quietHoursStart as string);
  }
  if (input.quietHoursEnd !== undefined) {
    if (!isValidQuietHours(input.quietHoursEnd)) {
      throw new IntegrationValidationError("INVALID_QUIET_HOURS");
    }
    data.quietHoursEnd =
      input.quietHoursEnd === "" ? null : (input.quietHoursEnd as string);
  }
  if (input.isEnabled !== undefined) {
    if (typeof input.isEnabled !== "boolean") {
      throw new IntegrationValidationError("INVALID_VALUE");
    }
    data.isEnabled = input.isEnabled;
  }
  const updated = await db.integrationSubscription.update({
    where: { id: current.id },
    data,
  });
  return {
    id: updated.id,
    endpointId: updated.endpointId,
    eventType: updated.eventType as IntegrationEventType,
    privacyLevel: updated.privacyLevel as PrivacyLevel,
    quietHoursStart: updated.quietHoursStart,
    quietHoursEnd: updated.quietHoursEnd,
    isEnabled: updated.isEnabled,
  };
}
