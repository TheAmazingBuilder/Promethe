-- Promethe — database access model for Supabase PostgreSQL.
--
-- Promethe uses custom application authentication (opaque httpOnly session
-- cookies and CUID user IDs), not Supabase Auth. Therefore auth.uid() cannot
-- identify a Promethe user. Prisma connects server-side using the database
-- owner role, which bypasses RLS unless FORCE ROW LEVEL SECURITY is enabled.
--
-- This script applies ONLY to the 96 tables declared in prisma/schema.prisma.
-- It deliberately does not alter unrelated public tables, Supabase-managed
-- objects, Storage tables, functions, schema usage, or application data.
--
-- Security boundary:
--   1. Browser requests go through the authenticated Promethe API.
--   2. The API resolves the custom session.
--   3. Tenant-owned queries MUST scope records by userId.
--   4. anon/authenticated PostgREST roles cannot access Promethe tables.
--
-- This is application-layer tenant isolation, NOT per-user PostgreSQL RLS.
-- Do not execute if another client depends on direct PostgREST access to these
-- Promethe tables. No data rows are changed by this script.

BEGIN;

DO $$
DECLARE
  app_table text;
  target_policy record;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'users',
    'auth_sessions',
    'profiles',
    'accounts',
    'cash_transactions',
    'instruments',
    'strategies',
    'setups',
    'playbook_rules',
    'checklist_templates',
    'strategy_checklist_items',
    'strategy_versions',
    'saved_views',
    'trades',
    'trade_executions',
    'tags',
    'trade_tags',
    'trade_screenshots',
    'journal_entries',
    'journal_period_reviews',
    'journal_templates',
    'trading_rules',
    'goals',
    'trade_rule_violations',
    'trade_templates',
    'push_subscriptions',
    'push_outbox',
    'reminder_settings',
    'notification_logs',
    'offline_sync_logs',
    'trade_reviews',
    'review_question_templates',
    'reports',
    'report_settings',
    'scenarios',
    'monte_carlo_runs',
    'economic_events',
    'economic_calendar_sync_states',
    'trade_event_links',
    'event_watchlists',
    'market_context_snapshots',
    'price_candles',
    'prop_firm_rule_sets',
    'prop_challenges',
    'prop_challenge_phase_results',
    'prop_payouts',
    'prop_expenses',
    'prop_finance_audits',
    'prop_alert_states',
    'broker_connections',
    'sync_event_logs',
    'symbol_mappings',
    'magic_number_mappings',
    'trade_modifications',
    'tool_scenarios',
    'fx_rates',
    'market_session_settings',
    'exit_plans',
    'exposure_alert_settings',
    'account_equity_snapshots',
    'import_batches',
    'reconciliation_candidates',
    'trade_merge_logs',
    'share_links',
    'trade_comments',
    'consent_records',
    'account_deletion_requests',
    'deleted_user_tombstones',
    'data_export_logs',
    'rate_limit_buckets',
    'dashboards',
    'dashboard_widgets',
    'custom_metrics',
    'user_dashboard_templates',
    'user_appearances',
    'saved_charts',
    'chart_annotations',
    'benchmark_profiles',
    'keyboard_shortcuts',
    'table_column_preferences',
    'custom_field_definitions',
    'change_logs',
    'batch_entry_drafts',
    'user_display_preferences',
    'gaia_notes',
    'gaia_folders',
    'gaia_tags',
    'gaia_templates',
    'gaia_versions',
    'trade_lifecycle_stats',
    'trader_score_snapshots',
    'trade_anomalies',
    'weekly_plan_actions',
    'integration_endpoints',
    'integration_subscriptions',
    'outbound_messages'
  ]::text[]
  LOOP
    IF to_regclass(format('%I.%I', 'public', app_table)) IS NULL THEN
      CONTINUE;
    END IF;

    FOR target_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = app_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        target_policy.policyname,
        app_table
      );
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY',
      app_table
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
      app_table
    );
  END LOOP;
END
$$;

-- Prevent future Prisma tables created by the current migration owner from
-- being exposed to the Supabase client roles by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

COMMIT;
