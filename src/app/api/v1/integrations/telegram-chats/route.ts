/**
 * Versioned alias of /api/integrations/telegram-chats.
 *
 * Re-exports the handlers from src/app/api/integrations/telegram-chats/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../integrations/telegram-chats/route";
