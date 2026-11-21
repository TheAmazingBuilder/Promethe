/** Durable fixed-window limits for public authentication entry points. */
export const AUTH_RATE_LIMITS = {
  login: {
    email: { limit: 5, windowMs: 15 * 60 * 1000 },
    ip: { limit: 20, windowMs: 15 * 60 * 1000 },
  },
  signup: {
    email: { limit: 3, windowMs: 60 * 60 * 1000 },
    ip: { limit: 10, windowMs: 15 * 60 * 1000 },
  },
  google: {
    ip: { limit: 30, windowMs: 15 * 60 * 1000 },
  },
} as const;
