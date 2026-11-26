/**
 * v3 Phase 6 — Data portability (RGPD art. 20): full ZIP export of EVERYTHING
 * the app stores about one user, in structured JSON + the original screenshot
 * files. Server-only.
 *
 * Principles:
 *  - COMPLETE: every model with a user relation is exported (see manifest).
 *    Gaïa notes, dashboards, playbook data, journal reviews, preferences,
 *    charts, analytics, changelog, drafts and integrations are included
 *    alongside trades and journal entries (lot 15 closed the gaps).
 *  - STRUCTURAL: secrets never leave the server — passwordHash, token hashes
 *    (broker connections, share links) and live session
 *    ids are excluded BY QUERY (select lists), not filtered afterwards.
 *    Push subscription endpoint + keys (browser push credentials) and
 *    integration endpoint secrets are metadata-only for the same reason.
 *  - EXACT: decimals are serialized as strings (never floats), dates as ISO.
 *  - RATE-LIMITED: one full export per 24 h (DB bucket, key = HMAC of userId).
 *  - LOGGED: DataExportLog row (kind FULL, size, schema version) for the
 *    in-app history and the transparency principle (art. 12 RGPD).
 */
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { db } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { hashUserId } from "@/lib/tokens";
import { readUpload } from "@/server/uploads";
import { createId } from "@/lib/id";

export const EXPORT_SCHEMA_VERSION = "1.0.0";
export const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type ExportRequestResult =
  | { ok: true; bytes: Uint8Array; fileName: string; sizeBytes: number }
  | { ok: false; code: "USER_NOT_FOUND" | "RATE_LIMITED"; retryAfterMs?: number };

/** Rounds dates to ISO strings, decimals to strings - JSON-safe snapshot. */
function plain<T>(rows: T): unknown {
  return JSON.parse(JSON.stringify(rows));
}

/** Zip entry helper: JSON pretty-printed for human diffing. */
function jsonEntry(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

interface ScreenshotFile {
  zipPath: string;
  bytes: Uint8Array;
}

export async function buildUserExport(userId: string): Promise<{
  zip: Uint8Array;
  counts: Record<string, number>;
  missingFiles: string[];
} | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      profile: true,
    },
  });
  if (!user) return null;

  const email = user.email;

  // ── Parallel domain loads (every model with a user relation) ─────────────
  const [
    accounts,
    instruments,
    strategies,
    tags,
    trades,
    journalEntries,
    tradingRules,
    goals,
    savedViews,
    templates,
    cashTransactions,
    reviewQuestionTemplates,
    reports,
    reportSetting,
    scenarios,
    monteCarloRuns,
    economicEvents,
    eventWatchlist,
    propFirmRuleSets,
    propChallenges,
    propPayouts,
    propExpenses,
    propFinanceAudits,
    brokerConnections,
    syncEventLogs,
    symbolMappings,
    magicNumberMappings,
    equitySnapshots,
    importBatches,
    reconciliationCandidates,
    tradeMergeLogs,
    shareLinks,
    commentsAuthored,
    commentsOnMyTrades,
    notifications,
    offlineSyncLogs,
    pushSubscriptions,
    reminderSettings,
    authSessions,
    consentRecords,
    dataExportLogs,
    deletionRequest,
    // ── Lot 15: every remaining user-owned model ──────────────────────────
    notes,
    noteFolders,
    noteTags,
    noteTemplates,
    dashboards,
    setups,
    playbookRules,
    checklistTemplates,
    journalPeriodReviews,
    journalTemplates,
    customMetrics,
    savedCharts,
    chartAnnotations,
    benchmarkProfiles,
    displayPreference,
    appearance,
    shortcuts,
    columnPreferences,
    customFieldDefinitions,
    dashboardTemplates,
    marketSessionSettings,
    exitPlans,
    exposureAlertSettings,
    lifecycleStats,
    scoreSnapshots,
    anomalies,
    weeklyPlanActions,
    fxRates,
    changeLogs,
    batchDrafts,
    integrationEndpoints,
    integrationSubscriptions,
    outboundMessages,
  ] = await Promise.all([
    db.account.findMany({ where: { userId } }),
    db.instrument.findMany({ where: { userId } }),
    db.strategy.findMany({
      where: { userId },
      include: { checklistItems: true, versions: true },
    }),
    db.tag.findMany({ where: { userId } }),
    db.trade.findMany({
      where: { userId },
      include: {
        executions: true,
        tags: true,
        screenshots: true,
        ruleViolations: true,
        eventLinks: true,
        modifications: true,
        review: true,
        marketContext: true,
      },
    }),
    db.journalEntry.findMany({ where: { userId } }),
    db.tradingRule.findMany({ where: { userId } }),
    db.goal.findMany({ where: { userId } }),
    db.savedView.findMany({ where: { userId } }),
    db.tradeTemplate.findMany({ where: { userId } }),
    db.cashTransaction.findMany({ where: { userId } }),
    db.reviewQuestionTemplate.findMany({ where: { userId } }),
    db.report.findMany({ where: { userId } }),
    db.reportSetting.findUnique({ where: { userId } }),
    db.scenario.findMany({ where: { userId } }),
    db.monteCarloRun.findMany({ where: { userId } }),
    db.economicEvent.findMany({ where: { userId } }),
    db.eventWatchlist.findMany({ where: { userId } }),
    db.propFirmRuleSet.findMany({ where: { userId } }),
    db.propChallenge.findMany({
      where: { userId },
      // §13: soft-deleted movements are not live rows; their data survives
      // in the finance audit trail (propFinanceAudits below).
      include: {
        phaseResults: true,
        payouts: { where: { deletedAt: null } },
        expenses: { where: { deletedAt: null } },
        alertStates: true,
      },
    }),
    db.propPayout.findMany({ where: { userId, deletedAt: null } }),
    db.propExpense.findMany({ where: { userId, deletedAt: null } }),
    db.propFinanceAudit.findMany({ where: { userId } }),
    // tokenHash excluded BY SELECT — a DB/backup leak of the export must not
    // help forging EA connection tokens.
    db.brokerConnection.findMany({
      where: { userId },
      select: {
        id: true,
        accountId: true,
        platform: true,
        label: true,
        brokerServer: true,
        brokerLogin: true,
        status: true,
        autoMergeEnabled: true,
        createdAt: true,
        revokedAt: true,
        lastHeartbeatAt: true,
        lastEventAt: true,
        eaVersion: true,
        historyBackfillFrom: true,
        tokenPrefix: true,
      },
    }),
    db.syncEventLog.findMany({ where: { userId } }),
    db.symbolMapping.findMany({ where: { userId } }),
    db.magicNumberMapping.findMany({ where: { userId } }),
    db.accountEquitySnapshot.findMany({ where: { userId } }),
    db.importBatch.findMany({ where: { userId } }),
    db.reconciliationCandidate.findMany({ where: { userId } }),
    db.tradeMergeLog.findMany({ where: { userId } }),
    // tokenHash / snapshotJson excluded by select — snapshots contain full
    // trade data already exported under trades.json.
    db.shareLink.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        targetId: true,
        title: true,
        mode: true,
        redactionJson: true,
        createdAt: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
        lastViewedAt: true,
        revokedAt: true,
        tokenPrefix: true,
      },
    }),
    db.tradeComment.findMany({ where: { authorId: userId } }),
    db.tradeComment.findMany({ where: { ownerId: userId } }),
    db.notificationLog.findMany({ where: { userId } }),
    db.offlineSyncLog.findMany({ where: { userId } }),
    // Push endpoint + keys ARE browser push credentials (a bearer URL plus
    // encryption keys): metadata only, never the values. The user re-enables
    // push in the browser instead of importing credentials.
    db.pushSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
      },
    }),
    db.reminderSetting.findMany({ where: { userId } }),
    // Session ids ARE the bearer credentials — never exported. Metadata only.
    db.authSession.findMany({
      where: { userId },
      select: { createdAt: true, expiresAt: true },
    }),
    db.consentRecord.findMany({ where: { userId } }),
    db.dataExportLog.findMany({ where: { userId } }),
    db.accountDeletionRequest.findUnique({ where: { userId } }),
    // ── Lot 15 loads (one query per remaining user-owned model) ──────────
    db.note.findMany({ where: { userId }, include: { versions: true } }),
    db.noteFolder.findMany({ where: { userId } }),
    db.noteTag.findMany({ where: { userId } }),
    db.noteTemplate.findMany({ where: { userId } }),
    db.dashboard.findMany({ where: { userId }, include: { widgets: true } }),
    db.setup.findMany({ where: { userId } }),
    db.playbookRule.findMany({ where: { userId } }),
    db.checklistTemplate.findMany({ where: { userId } }),
    db.journalPeriodReview.findMany({ where: { userId } }),
    db.journalTemplate.findMany({ where: { userId } }),
    db.customMetric.findMany({ where: { userId } }),
    db.savedChart.findMany({ where: { userId } }),
    db.chartAnnotation.findMany({ where: { userId } }),
    db.benchmarkProfile.findMany({ where: { userId } }),
    db.userDisplayPreference.findUnique({ where: { userId } }),
    db.userAppearance.findUnique({ where: { userId } }),
    db.keyboardShortcut.findMany({ where: { userId } }),
    db.tableColumnPreference.findMany({ where: { userId } }),
    db.customFieldDefinition.findMany({ where: { userId } }),
    db.userDashboardTemplate.findMany({ where: { userId } }),
    db.marketSessionSetting.findMany({ where: { userId } }),
    db.exitPlan.findMany({ where: { userId } }),
    db.exposureAlertSetting.findUnique({ where: { userId } }),
    db.tradeLifecycleStats.findMany({ where: { userId } }),
    db.traderScoreSnapshot.findMany({ where: { userId } }),
    db.tradeAnomaly.findMany({ where: { userId } }),
    db.weeklyPlanAction.findMany({ where: { userId } }),
    db.fxRate.findMany({ where: { userId } }),
    db.changeLog.findMany({ where: { userId } }),
    db.batchEntryDraft.findMany({ where: { userId } }),
    // Integration endpoint secret is AES-256-GCM ciphertext of the webhook
    // URL / bot token: metadata only, never the ciphertext (the display hint
    // is left out too - it exists to recognize the secret, not to travel).
    db.integrationEndpoint.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        label: true,
        chatId: true,
        isEnabled: true,
        consecutiveFailures: true,
        lastErrorAt: true,
        lastSentAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.integrationSubscription.findMany({ where: { userId } }),
    db.outboundMessage.findMany({ where: { userId } }),
  ]);

  // Screenshot metadata lives on trades; private objects are read from Supabase Storage.
  const screenshots = trades.flatMap((t) => t.screenshots);
  const files: ScreenshotFile[] = [];
  const missingFiles: string[] = [];
  for (const shot of screenshots) {
    const stored = await readUpload(userId, shot.id);
    if (!stored) {
      // File already gone (legacy local storage or previous deletion).
      missingFiles.push(shot.storagePath);
      continue;
    }

    files.push({
      zipPath: `screenshots/${shot.id}${path.extname(shot.storagePath)}`,
      bytes: new Uint8Array(stored.buffer),
    });
  }

  const exportedAt = new Date();
  const counts: Record<string, number> = {
    accounts: accounts.length,
    instruments: instruments.length,
    strategies: strategies.length,
    tags: tags.length,
    trades: trades.length,
    screenshots: screenshots.length,
    screenshotFiles: files.length,
    journalEntries: journalEntries.length,
    tradingRules: tradingRules.length,
    goals: goals.length,
    savedViews: savedViews.length,
    templates: templates.length,
    cashTransactions: cashTransactions.length,
    comments: commentsAuthored.length + commentsOnMyTrades.length,
    notifications: notifications.length,
    consentRecords: consentRecords.length,
    gaiaNotes: notes.length,
    gaiaNoteVersions: notes.reduce((n, note) => n + note.versions.length, 0),
    dashboards: dashboards.length,
    setups: setups.length,
    playbookRules: playbookRules.length,
    journalPeriodReviews: journalPeriodReviews.length,
    savedCharts: savedCharts.length,
    chartAnnotations: chartAnnotations.length,
    changeLogs: changeLogs.length,
    integrationEndpoints: integrationEndpoints.length,
    propFinanceAudits: propFinanceAudits.length,
  };

  const manifest = {
    application: "Promethe",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    user: { email: user.email, createdAt: user.createdAt.toISOString() },
    counts,
    missingScreenshotFiles: missingFiles,
    // Transparency: what is NOT in the archive and why (art. 12 RGPD).
    excluded: [
      "passwordHash - one-way scrypt hash, never disclosed",
      "tokenHash (broker connections, share links) - server-side HMAC digests, useless without the pepper",
      "authSession ids - live bearer credentials",
      "push subscription endpoint + keys - browser push credentials, re-enable push in the browser instead",
      "secretEncrypted (integration endpoints) - AES-256-GCM webhook secrets, never disclosed",
      "raw tokens of any kind - never stored by the app",
    ],
  };

  const readme = [
    "Promethe - Full export of your data (GDPR art. 20)",
    "",
    `Generated: ${exportedAt.toISOString()}`,
    `Schema version: ${EXPORT_SCHEMA_VERSION}`,
    "",
    "Contents:",
    "  manifest.json        export inventory (counts, exclusions)",
    "  profile.json         account, profile, sessions (metadata)",
    "  accounts.json        trading accounts",
    "  instruments.json     instruments used",
    "  strategies.json      strategies + checklists + versions",
    "  tags.json            tags",
    "  trades.json          trades + executions, screenshots, reviews, violations,",
    "                       changes, market context",
    "  screenshots/         original screenshot files (WebP)",
    "  journal.json         journal entries",
    "  journal-reviews.json period reviews + journal templates",
    "  gaia.json            Gaïa notes + folders + tags + templates + versions",
    "  dashboards.json      dashboards + widgets",
    "  playbook.json        setups + playbook rules + checklist templates",
    "  rules.json           trading rules",
    "  goals.json           goals",
    "  views.json           saved views",
    "  templates.json       trade templates",
    "  cash.json            cash transactions",
    "  reviews.json         review question templates",
    "  reports.json         reports + report settings",
    "  scenarios.json       scenarios + Monte Carlo simulations",
    "  calendar.json        economic events + watchlist",
    "  propfirms.json       prop firms, challenges, phases, payouts, expenses, finance audit",
    "  sync.json            broker connections, sync logs, mappings,",
    "                      equity snapshots, imports, candidates, merges",
    "  sharing.json         share links (metadata)",
    "  comments.json        comments (written on my trades)",
    "  notifications.json   in-app notifications",
    "  misc.json            push subscriptions (metadata), reminders,",
    "                      offline sync",
    "  preferences.json     display preferences, appearance, shortcuts,",
    "                      table columns, custom fields, dashboard templates,",
    "                      market sessions, exit plans, exposure alerts",
    "  charts.json          saved charts, annotations, benchmarks",
    "  analytics.json       lifecycle stats, trader score snapshots,",
    "                      anomalies, weekly plan actions, FX rates,",
    "                      custom metrics",
    "  changelog.json       change history (undo snapshots)",
    "  drafts.json          batch entry drafts",
    "  integrations.json    integration endpoints (metadata), subscriptions,",
    "                      outbound messages",
    "  consents.json        consents (Terms, privacy)",
    "  exports.json         your export history",
    "  deletion.json        pending deletion request (if any)",
    "",
    "Excluded secrets: see manifest.json.",
    "Amounts are exact decimal strings - never floating point.",
  ].join("\n");

  // ── Assemble the ZIP ──────────────────────────────────────────────────────
  const entries: Record<string, Uint8Array> = {
    "manifest.json": jsonEntry(manifest),
    "README.txt": strToU8(readme),
    "profile.json": jsonEntry(
      plain({
        user: {
          email: user.email,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        profile: user.profile,
        sessions: authSessions, // metadata only (see select)
      })
    ),
    "accounts.json": jsonEntry(plain(accounts)),
    "instruments.json": jsonEntry(plain(instruments)),
    "strategies.json": jsonEntry(plain(strategies)),
    "tags.json": jsonEntry(plain(tags)),
    "trades.json": jsonEntry(plain(trades)),
    "journal.json": jsonEntry(plain(journalEntries)),
    "journal-reviews.json": jsonEntry(
      plain({ periodReviews: journalPeriodReviews, templates: journalTemplates })
    ),
    "gaia.json": jsonEntry(
      plain({
        notes,
        folders: noteFolders,
        tags: noteTags,
        templates: noteTemplates,
      })
    ),
    "dashboards.json": jsonEntry(plain(dashboards)),
    "playbook.json": jsonEntry(
      plain({
        setups,
        playbookRules,
        checklistTemplates,
      })
    ),
    "rules.json": jsonEntry(plain(tradingRules)),
    "goals.json": jsonEntry(plain(goals)),
    "views.json": jsonEntry(plain(savedViews)),
    "templates.json": jsonEntry(plain(templates)),
    "cash.json": jsonEntry(plain(cashTransactions)),
    "reviews.json": jsonEntry(plain(reviewQuestionTemplates)),
    "reports.json": jsonEntry(
      plain({ reports, reportSetting })
    ),
    "scenarios.json": jsonEntry(plain({ scenarios, monteCarloRuns })),
    "calendar.json": jsonEntry(plain({ economicEvents, eventWatchlist })),
    "propfirms.json": jsonEntry(
      plain({
        ruleSets: propFirmRuleSets,
        challenges: propChallenges,
        payouts: propPayouts,
        expenses: propExpenses,
        financeAudits: propFinanceAudits,
      })
    ),
    "sync.json": jsonEntry(
      plain({
        brokerConnections, // tokenHash excluded by select
        syncEventLogs,
        symbolMappings,
        magicNumberMappings,
        equitySnapshots,
        importBatches,
        reconciliationCandidates,
        tradeMergeLogs,
      })
    ),
    "sharing.json": jsonEntry(plain(shareLinks)),
    "comments.json": jsonEntry(
      plain({
        authored: commentsAuthored,
        onMyTrades: commentsOnMyTrades,
      })
    ),
    "notifications.json": jsonEntry(plain(notifications)),
    "misc.json": jsonEntry(
      plain({
        pushSubscriptions, // metadata only (endpoint + keys excluded by select)
        reminderSettings,
        offlineSyncLogs,
      })
    ),
    "preferences.json": jsonEntry(
      plain({
        displayPreference,
        appearance,
        shortcuts,
        columnPreferences,
        customFieldDefinitions,
        dashboardTemplates,
        marketSessionSettings,
        exitPlans,
        exposureAlertSettings,
      })
    ),
    "charts.json": jsonEntry(
      plain({
        savedCharts,
        annotations: chartAnnotations,
        benchmarks: benchmarkProfiles,
      })
    ),
    "analytics.json": jsonEntry(
      plain({
        lifecycleStats,
        scoreSnapshots,
        anomalies,
        weeklyPlanActions,
        fxRates,
        customMetrics,
      })
    ),
    "changelog.json": jsonEntry(plain(changeLogs)),
    "drafts.json": jsonEntry(plain(batchDrafts)),
    "integrations.json": jsonEntry(
      plain({
        endpoints: integrationEndpoints, // secretEncrypted excluded by select
        subscriptions: integrationSubscriptions,
        outboundMessages,
      })
    ),
    "consents.json": jsonEntry(plain(consentRecords)),
    "exports.json": jsonEntry(plain(dataExportLogs)),
    "deletion.json": jsonEntry(
      plain(deletionRequest ?? { note: "No deletion request" })
    ),
  };
  for (const file of files) entries[file.zipPath] = file.bytes;

  const zip = zipSync(entries, { level: 6 });
  return { zip, counts, missingFiles };
}

/**
 * Export with the 24 h cooldown + history logging. The cooldown bucket key is
 * the HMAC of the userId (RateLimitBucket stores no raw identifiers).
 */
export async function requestUserExport(userId: string): Promise<ExportRequestResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { ok: false, code: "USER_NOT_FOUND" };

  const limit = await consumeRateLimit(
    `export:${hashUserId(userId)}`,
    1,
    EXPORT_COOLDOWN_MS
  );
  if (!limit.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      retryAfterMs: Math.max(0, limit.resetAt - Date.now()),
    };
  }

  const built = await buildUserExport(userId);
  if (!built) return { ok: false, code: "USER_NOT_FOUND" };

  const sizeBytes = built.zip.byteLength;
  const day = new Date().toISOString().slice(0, 10);
  const fileName = `tradejournal-export-${day}-${createId().slice(0, 8)}.zip`;

  await db.dataExportLog.create({
    data: {
      userId,
      kind: "FULL",
      sizeBytes,
      schemaVersion: EXPORT_SCHEMA_VERSION,
    },
  });

  return { ok: true, bytes: built.zip, fileName, sizeBytes };
}

/** Export history for the settings view (most recent first). */
export async function listExportHistory(
  userId: string
): Promise<
  { id: string; createdAt: Date; kind: string; sizeBytes: number | null; schemaVersion: string }[]
> {
  return db.dataExportLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      createdAt: true,
      kind: true,
      sizeBytes: true,
      schemaVersion: true,
    },
  });
}
