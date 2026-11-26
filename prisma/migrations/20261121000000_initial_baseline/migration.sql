-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "base_currency" TEXT NOT NULL DEFAULT 'USD',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "default_account_id" TEXT,
    "preferences_json" TEXT NOT NULL DEFAULT '{}',
    "handle" TEXT,
    "public_display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "broker" TEXT,
    "type" TEXT NOT NULL DEFAULT 'LIVE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "initial_balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "leverage" INTEGER,
    "margin_call_level" DECIMAL(65,30),
    "stop_out_level" DECIMAL(65,30),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_daily_loss_percent" DECIMAL(65,30),
    "max_total_drawdown_percent" DECIMAL(65,30),
    "profit_target" DECIMAL(65,30),
    "drawdown_type" TEXT,
    "start_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "broker_server" TEXT,
    "broker_login" TEXT,
    "server_timezone_mode" TEXT NOT NULL DEFAULT 'IANA',
    "server_timezone" TEXT,
    "server_fixed_offset_minutes" INTEGER,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "external_id" TEXT,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_class" TEXT NOT NULL,
    "base_currency" TEXT,
    "quote_currency" TEXT NOT NULL DEFAULT 'USD',
    "digits" INTEGER NOT NULL DEFAULT 5,
    "pip_size" DECIMAL(65,30) NOT NULL DEFAULT 0.0001,
    "point_size" DECIMAL(65,30) NOT NULL DEFAULT 0.00001,
    "contract_size" DECIMAL(65,30) NOT NULL DEFAULT 100000,
    "tick_size" DECIMAL(65,30),
    "tick_value" DECIMAL(65,30),
    "market_timezone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#10b981',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timeframes_json" TEXT,
    "instruments_json" TEXT,
    "sessions_json" TEXT,
    "entry_rules" TEXT,
    "exit_rules" TEXT,
    "risk_rules" TEXT,
    "default_risk_percent" DECIMAL(65,30),
    "target_rr" DECIMAL(65,30),
    "version" INTEGER NOT NULL DEFAULT 1,
    "grade" TEXT,
    "detailed_description" TEXT,
    "tags_json" TEXT,
    "market_profile_json" TEXT,
    "market_conditions_json" TEXT,
    "entry_conditions_json" TEXT,
    "confirmations_json" TEXT,
    "invalidations_json" TEXT,
    "risk_json" TEXT,
    "trade_management_json" TEXT,
    "exit_plan_json" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "search_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "context" TEXT,
    "market_condition" TEXT,
    "trigger" TEXT,
    "confirmation" TEXT,
    "entry_model" TEXT,
    "stop_model" TEXT,
    "target_model" TEXT,
    "invalidation" TEXT NOT NULL,
    "notes" TEXT,
    "tags_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbook_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "strategy_id" TEXT,
    "evaluatable" BOOLEAN NOT NULL DEFAULT false,
    "evaluation_hint" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbook_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "strategy_id" TEXT,
    "name" TEXT NOT NULL,
    "items_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_checklist_items" (
    "id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ENTRY',
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "strategy_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_versions" (
    "id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "note" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters_json" TEXT NOT NULL,
    "entity" TEXT,
    "columns_json" TEXT,
    "sort_json" TEXT,
    "grouping_json" TEXT,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "strategy_id" TEXT,
    "instrument_id" TEXT NOT NULL,
    "external_id" TEXT,
    "direction" TEXT NOT NULL,
    "order_type" TEXT NOT NULL DEFAULT 'MARKET',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "timeframe" TEXT,
    "session" TEXT,
    "setup_type" TEXT,
    "setup_id" TEXT,
    "strategy_version" INTEGER,
    "market_condition" TEXT,
    "entry_time" TIMESTAMP(3) NOT NULL,
    "exit_time" TIMESTAMP(3),
    "entry_price" DECIMAL(65,30) NOT NULL,
    "exit_price" DECIMAL(65,30),
    "stop_loss" DECIMAL(65,30),
    "take_profit" DECIMAL(65,30),
    "initial_stop_loss" DECIMAL(65,30),
    "initial_take_profit" DECIMAL(65,30),
    "mfe_price" DECIMAL(65,30),
    "mae_price" DECIMAL(65,30),
    "current_price" DECIMAL(65,30),
    "lots" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "units" DECIMAL(65,30),
    "risk_amount" DECIMAL(65,30),
    "risk_percent" DECIMAL(65,30),
    "account_balance_at_entry" DECIMAL(65,30),
    "pips" DECIMAL(65,30),
    "points" DECIMAL(65,30),
    "gross_pnl" DECIMAL(65,30),
    "commission" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "swap" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fees" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "net_pnl" DECIMAL(65,30),
    "pnl_currency" TEXT NOT NULL DEFAULT 'USD',
    "r_multiple" DECIMAL(65,30),
    "planned_rr" DECIMAL(65,30),
    "realized_rr" DECIMAL(65,30),
    "result_type" TEXT,
    "pnl_source" TEXT NOT NULL DEFAULT 'CALCULATED',
    "exit_reason" TEXT,
    "emotion_before" TEXT,
    "emotion_during" TEXT,
    "emotion_after" TEXT,
    "confidence" INTEGER,
    "setup_quality_rating" INTEGER,
    "execution_rating" INTEGER,
    "followed_plan" BOOLEAN,
    "grade" TEXT,
    "lesson_learned" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
    "is_draft" BOOLEAN NOT NULL DEFAULT false,
    "client_mutation_id" TEXT,
    "planned_risk_percent" DECIMAL(65,30),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "position_id" TEXT,
    "magic_number" TEXT,
    "broker_comment" TEXT,
    "needs_details" BOOLEAN NOT NULL DEFAULT false,
    "mfe_mae_source" TEXT NOT NULL DEFAULT 'NONE',
    "mfe_mae_complete" BOOLEAN NOT NULL DEFAULT false,
    "pre_trade_analysis" TEXT NOT NULL,
    "post_trade_review" TEXT NOT NULL,
    "notes" TEXT,
    "trading_view_url" TEXT,
    "checklist_results" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "custom_fields" TEXT,
    "search_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "exit_plan_id" TEXT,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_executions" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "lots" DECIMAL(65,30) NOT NULL,
    "commission" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pnl" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_tags" (
    "trade_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "trade_tags_pkey" PRIMARY KEY ("trade_id","tag_id")
);

-- CreateTable
CREATE TABLE "trade_screenshots" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "label" TEXT,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "pre_market_plan" TEXT,
    "post_market_review" TEXT,
    "mood" INTEGER,
    "sleep_quality" INTEGER,
    "discipline_score" INTEGER,
    "key_lesson" TEXT,
    "market_bias" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "search_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trading_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metric" TEXT NOT NULL,
    "target_value" DECIMAL(65,30) NOT NULL,
    "period" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_rule_violations" (
    "trade_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_rule_violations_pkey" PRIMARY KEY ("trade_id","rule_id")
);

-- CreateTable
CREATE TABLE "trade_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "strategy_id" TEXT,
    "instrument_id" TEXT,
    "name" TEXT NOT NULL,
    "direction" TEXT,
    "timeframe" TEXT,
    "session" TEXT,
    "order_type" TEXT,
    "default_risk_percent" DECIMAL(65,30),
    "default_risk_amount" DECIMAL(65,30),
    "default_lots" DECIMAL(65,30),
    "default_stop_loss_pips" DECIMAL(65,30),
    "default_take_profit_pips" DECIMAL(65,30),
    "default_tag_ids" TEXT,
    "default_checklist_item_ids" TEXT,
    "prefilled_notes" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channel" TEXT NOT NULL DEFAULT 'BOTH',
    "localTime" TEXT NOT NULL DEFAULT '20:00',
    "days_of_week" TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_reviews" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "playbook_match" TEXT,
    "followedPlan" BOOLEAN,
    "plan_adherence_score" INTEGER,
    "execution_quality" INTEGER,
    "entry_quality" INTEGER,
    "exit_quality" INTEGER,
    "risk_management_score" INTEGER,
    "emotional_control_score" INTEGER,
    "would_take_again" TEXT,
    "main_lesson" TEXT,
    "what_went_well" TEXT,
    "what_to_improve" TEXT,
    "mistake_tag_ids" TEXT,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_question_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SCALE',
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_question_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "account_id" TEXT,
    "stats_snapshot" TEXT NOT NULL,
    "insights_snapshot" TEXT NOT NULL,
    "pdf_storage_path" TEXT,
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "weekly_enabled" BOOLEAN NOT NULL DEFAULT true,
    "monthly_enabled" BOOLEAN NOT NULL DEFAULT true,
    "weekly_day_of_week" INTEGER NOT NULL DEFAULT 1,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "email_address" TEXT,
    "include_screenshots" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',

    CONSTRAINT "report_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "params_json" TEXT NOT NULL,
    "result_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monte_carlo_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params_json" TEXT NOT NULL,
    "result_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monte_carlo_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economic_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "external_id" TEXT,
    "title" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "country" TEXT,
    "impact" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "actual" TEXT,
    "forecast" TEXT,
    "previous" TEXT,
    "unit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "economic_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_event_links" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "auto_linked" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_watchlists" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currencies" TEXT NOT NULL DEFAULT '["USD"]',
    "categories" TEXT NOT NULL DEFAULT '[]',
    "min_impact" TEXT NOT NULL DEFAULT 'MEDIUM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_context_snapshots" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "instrument_id" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "atr14_value" DECIMAL(65,30) NOT NULL,
    "atr14_pips" DECIMAL(65,30) NOT NULL,
    "atr_percentile" DECIMAL(65,30),
    "daily_range_pips" DECIMAL(65,30),
    "volatility_regime" TEXT NOT NULL,
    "trend_regime" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CSV',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_candles" (
    "id" TEXT NOT NULL,
    "instrument_id" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "open_time" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(65,30) NOT NULL,
    "high" DECIMAL(65,30) NOT NULL,
    "low" DECIMAL(65,30) NOT NULL,
    "close" DECIMAL(65,30) NOT NULL,
    "volume" DECIMAL(65,30),

    CONSTRAINT "price_candles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prop_firm_rule_sets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "phases" TEXT NOT NULL,
    "reset_time_local" TEXT NOT NULL DEFAULT '00:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prop_firm_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prop_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "rule_set_id" TEXT,
    "name" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "current_phase" TEXT NOT NULL DEFAULT 'PHASE_1',
    "account_size" DECIMAL(65,30) NOT NULL,
    "challenge_fee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fee_currency" TEXT NOT NULL DEFAULT 'USD',
    "purchase_date" TIMESTAMP(3),
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "rules_snapshot" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prop_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prop_challenge_phase_results" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "starting_balance" DECIMAL(65,30),
    "ending_balance" DECIMAL(65,30),
    "result" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "fail_reason" TEXT,
    "trading_days_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "prop_challenge_phase_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prop_payouts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3),
    "gross_amount" DECIMAL(65,30) NOT NULL,
    "profit_split_percent" DECIMAL(65,30) NOT NULL DEFAULT 80,
    "net_amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,

    CONSTRAINT "prop_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prop_expenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "challenge_id" TEXT,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "prop_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prop_alert_states" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day_key" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "prop_alert_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "broker_server" TEXT,
    "broker_login" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "last_heartbeat_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3),
    "ea_version" TEXT,
    "history_backfill_from" TIMESTAMP(3),
    "auto_merge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "broker_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_event_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "payload_json" TEXT,

    CONSTRAINT "sync_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "symbol_mappings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "broker_symbol" TEXT NOT NULL,
    "instrument_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "symbol_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_number_mappings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "magic_number" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_number_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_modifications" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "trade_modifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_scenarios" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "rate_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_session_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DISPLAY',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "open_time" TEXT NOT NULL,
    "close_time" TEXT NOT NULL,
    "active_days" TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_session_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tiers_json" TEXT NOT NULL,
    "breakeven_after_tier" INTEGER,
    "trailing_after_tier" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exit_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exposure_alert_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "duplication_threshold_percent" DECIMAL(65,30) NOT NULL DEFAULT 2,
    "max_currency_exposure_percent" DECIMAL(65,30) NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exposure_alert_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_equity_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL,
    "equity" DECIMAL(65,30) NOT NULL,
    "margin" DECIMAL(65,30),

    CONSTRAINT "account_equity_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "counts_json" TEXT NOT NULL DEFAULT '{}',
    "server_timezone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_candidates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "manual_trade_id" TEXT NOT NULL,
    "broker_trade_id" TEXT NOT NULL,
    "score" DECIMAL(65,30) NOT NULL,
    "reasons_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "reconciliation_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_merge_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "surviving_trade_id" TEXT NOT NULL,
    "absorbed_trade_snapshot" TEXT NOT NULL,
    "field_choices_json" TEXT NOT NULL,
    "merged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_merge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SNAPSHOT',
    "snapshot_json" TEXT,
    "redaction_json" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_views" INTEGER,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentor_invitations" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "permissions_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentor_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentor_accesses" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "mentor_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "account_scope" TEXT NOT NULL DEFAULT 'ALL',
    "account_ids_json" TEXT NOT NULL DEFAULT '[]',
    "strategy_scope" TEXT NOT NULL DEFAULT 'ALL',
    "strategy_ids_json" TEXT NOT NULL DEFAULT '[]',
    "can_view_amounts" BOOLEAN NOT NULL DEFAULT true,
    "can_view_journal" BOOLEAN NOT NULL DEFAULT false,
    "can_view_screenshots" BOOLEAN NOT NULL DEFAULT false,
    "can_view_analytics" BOOLEAN NOT NULL DEFAULT true,
    "can_comment" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),

    CONSTRAINT "mentor_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentor_access_logs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "mentor_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "day" TEXT NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mentor_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_comments" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "trade_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_mentions" (
    "comment_id" TEXT NOT NULL,
    "mentioned_user_id" TEXT NOT NULL,

    CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("comment_id","mentioned_user_id")
);

-- CreateTable
CREATE TABLE "comment_read_states" (
    "user_id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comment_read_states_pkey" PRIMARY KEY ("user_id","trade_id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "choices_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deleted_user_tombstones" (
    "id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deleted_user_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "schema_version" TEXT NOT NULL,

    CONSTRAINT "data_export_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'layout-dashboard',
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "template_key" TEXT,
    "layout_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL,
    "dashboard_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "layouts" TEXT NOT NULL,
    "period_override" TEXT,
    "account_override" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_metrics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'NUMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_dashboard_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_dashboard_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_appearances" (
    "user_id" TEXT NOT NULL,
    "palette_key" TEXT NOT NULL DEFAULT 'default',
    "gain_color" TEXT,
    "loss_color" TEXT,
    "neutral_color" TEXT,
    "density" TEXT NOT NULL DEFAULT 'COMFORTABLE',
    "chart_palette_key" TEXT NOT NULL DEFAULT 'default',
    "kpi_defaults" TEXT NOT NULL DEFAULT '{}',
    "focus_mode_config" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_appearances_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "saved_charts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_annotations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "label" TEXT NOT NULL,
    "note" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "color" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "account_id" TEXT,
    "strategy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "series_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyboard_shortcuts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "keys" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keyboard_shortcuts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_column_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "table_key" TEXT NOT NULL,
    "column_order" TEXT NOT NULL,
    "column_visibility" TEXT NOT NULL,
    "column_sizing" TEXT NOT NULL,
    "pinning" TEXT NOT NULL,
    "density" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_column_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "default_value" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "show_in_table" BOOLEAN NOT NULL DEFAULT false,
    "show_in_quick_form" BOOLEAN NOT NULL DEFAULT false,
    "usable_in_analytics" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before_json" TEXT,
    "after_json" TEXT,
    "source" TEXT NOT NULL DEFAULT 'UI',
    "undone_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_entry_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "rows_json" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_entry_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_display_preferences" (
    "user_id" TEXT NOT NULL,
    "privacy_mode" TEXT NOT NULL DEFAULT 'OFF',
    "privacy_scope" TEXT NOT NULL DEFAULT '{"hideCurrencyAmounts":true,"hideLots":false,"hideBalances":true,"hideAccountNames":false,"hideBrokerInfo":false,"hidePercentages":false,"hideRAndPips":false}',
    "privacy_auto_enable" TEXT NOT NULL DEFAULT '{"onWindowBlur":false,"onInactivitySeconds":null}',
    "privacy_shortcut" TEXT NOT NULL DEFAULT 'shift+h',
    "blur_screenshots" BOOLEAN NOT NULL DEFAULT false,
    "reveal_on_hover" BOOLEAN NOT NULL DEFAULT true,
    "hide_amounts_in_notifications" BOOLEAN NOT NULL DEFAULT false,
    "text_scale" INTEGER NOT NULL DEFAULT 100,
    "contrast_mode" TEXT NOT NULL DEFAULT 'SYSTEM',
    "reduced_motion" TEXT NOT NULL DEFAULT 'SYSTEM',
    "font_family" TEXT NOT NULL DEFAULT 'DEFAULT',
    "lineHeight" INTEGER,
    "letter_spacing" INTEGER,
    "focus_ring_style" TEXT NOT NULL DEFAULT 'STANDARD',
    "larger_touch_targets" BOOLEAN NOT NULL DEFAULT false,
    "underline_links" BOOLEAN NOT NULL DEFAULT false,
    "tabular_numbers" BOOLEAN NOT NULL DEFAULT false,
    "extra_timezones" TEXT NOT NULL DEFAULT '[]',
    "time_format" TEXT NOT NULL DEFAULT 'LOCALE',
    "week_starts_on" INTEGER NOT NULL DEFAULT 1,
    "trading_day_rollover_mode" TEXT NOT NULL DEFAULT 'MIDNIGHT_LOCAL',
    "trading_day_rollover_time" TEXT,
    "trading_day_rollover_timezone" TEXT,

    CONSTRAINT "user_display_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "gaia_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "folder_id" TEXT,
    "tag_ids" TEXT NOT NULL DEFAULT '[]',
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "template_id" TEXT,
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "last_viewed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gaia_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gaia_folders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gaia_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gaia_tags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gaia_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gaia_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '📄',
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gaia_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gaia_versions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "saved_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gaia_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_lifecycle_stats" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mfe_r" DECIMAL(65,30),
    "mae_r" DECIMAL(65,30),
    "time_in_profit_min" INTEGER,
    "time_in_loss_min" INTEGER,
    "almost_tp" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_lifecycle_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trader_score_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL,
    "discipline" INTEGER NOT NULL,
    "edge" INTEGER NOT NULL,
    "consistency" INTEGER NOT NULL,
    "risk" INTEGER NOT NULL,
    "trade_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trader_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_anomalies" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "z_score" DECIMAL(65,30) NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "rule" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_plan_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_endpoints" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "secret_hint" TEXT NOT NULL,
    "chat_id" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "privacy_level" TEXT NOT NULL DEFAULT 'FULL',
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_handle_key" ON "profiles"("handle");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "cash_transactions_user_id_idx" ON "cash_transactions"("user_id");

-- CreateIndex
CREATE INDEX "cash_transactions_user_id_date_idx" ON "cash_transactions"("user_id", "date");

-- CreateIndex
CREATE INDEX "cash_transactions_account_id_date_idx" ON "cash_transactions"("account_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_account_id_external_id_key" ON "cash_transactions"("account_id", "external_id");

-- CreateIndex
CREATE INDEX "instruments_user_id_idx" ON "instruments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_user_id_symbol_key" ON "instruments"("user_id", "symbol");

-- CreateIndex
CREATE INDEX "strategies_user_id_idx" ON "strategies"("user_id");

-- CreateIndex
CREATE INDEX "setups_user_id_idx" ON "setups"("user_id");

-- CreateIndex
CREATE INDEX "setups_strategy_id_idx" ON "setups"("strategy_id");

-- CreateIndex
CREATE INDEX "playbook_rules_user_id_idx" ON "playbook_rules"("user_id");

-- CreateIndex
CREATE INDEX "playbook_rules_strategy_id_idx" ON "playbook_rules"("strategy_id");

-- CreateIndex
CREATE INDEX "checklist_templates_user_id_idx" ON "checklist_templates"("user_id");

-- CreateIndex
CREATE INDEX "checklist_templates_strategy_id_idx" ON "checklist_templates"("strategy_id");

-- CreateIndex
CREATE INDEX "strategy_checklist_items_strategy_id_idx" ON "strategy_checklist_items"("strategy_id");

-- CreateIndex
CREATE INDEX "strategy_versions_strategy_id_version_idx" ON "strategy_versions"("strategy_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_versions_strategy_id_version_key" ON "strategy_versions"("strategy_id", "version");

-- CreateIndex
CREATE INDEX "saved_views_user_id_page_idx" ON "saved_views"("user_id", "page");

-- CreateIndex
CREATE INDEX "saved_views_user_id_entity_idx" ON "saved_views"("user_id", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_user_id_page_name_key" ON "saved_views"("user_id", "page", "name");

-- CreateIndex
CREATE UNIQUE INDEX "trades_client_mutation_id_key" ON "trades"("client_mutation_id");

-- CreateIndex
CREATE INDEX "trades_account_id_position_id_idx" ON "trades"("account_id", "position_id");

-- CreateIndex
CREATE INDEX "trades_user_id_entry_time_idx" ON "trades"("user_id", "entry_time");

-- CreateIndex
CREATE INDEX "trades_user_id_strategy_id_idx" ON "trades"("user_id", "strategy_id");

-- CreateIndex
CREATE INDEX "trades_user_id_setup_id_idx" ON "trades"("user_id", "setup_id");

-- CreateIndex
CREATE INDEX "trades_user_id_instrument_id_idx" ON "trades"("user_id", "instrument_id");

-- CreateIndex
CREATE INDEX "trades_user_id_status_idx" ON "trades"("user_id", "status");

-- CreateIndex
CREATE INDEX "trades_user_id_is_draft_idx" ON "trades"("user_id", "is_draft");

-- CreateIndex
CREATE INDEX "trades_user_id_review_status_idx" ON "trades"("user_id", "review_status");

-- CreateIndex
CREATE INDEX "trades_user_id_grade_idx" ON "trades"("user_id", "grade");

-- CreateIndex
CREATE INDEX "trades_user_id_deleted_at_idx" ON "trades"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "trades_account_id_idx" ON "trades"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "trades_account_id_external_id_key" ON "trades"("account_id", "external_id");

-- CreateIndex
CREATE INDEX "trade_executions_trade_id_idx" ON "trade_executions"("trade_id");

-- CreateIndex
CREATE INDEX "tags_user_id_idx" ON "tags"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_user_id_name_key" ON "tags"("user_id", "name");

-- CreateIndex
CREATE INDEX "trade_tags_tag_id_idx" ON "trade_tags"("tag_id");

-- CreateIndex
CREATE INDEX "trade_screenshots_trade_id_idx" ON "trade_screenshots"("trade_id");

-- CreateIndex
CREATE INDEX "trade_screenshots_user_id_idx" ON "trade_screenshots"("user_id");

-- CreateIndex
CREATE INDEX "journal_entries_user_id_idx" ON "journal_entries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_user_id_date_key" ON "journal_entries"("user_id", "date");

-- CreateIndex
CREATE INDEX "trading_rules_user_id_idx" ON "trading_rules"("user_id");

-- CreateIndex
CREATE INDEX "goals_user_id_idx" ON "goals"("user_id");

-- CreateIndex
CREATE INDEX "goals_user_id_status_idx" ON "goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "trade_rule_violations_rule_id_idx" ON "trade_rule_violations"("rule_id");

-- CreateIndex
CREATE INDEX "trade_templates_user_id_idx" ON "trade_templates"("user_id");

-- CreateIndex
CREATE INDEX "trade_templates_user_id_usage_count_idx" ON "trade_templates"("user_id", "usage_count");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "reminder_settings_user_id_idx" ON "reminder_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_settings_user_id_type_key" ON "reminder_settings"("user_id", "type");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_sent_at_idx" ON "notification_logs"("user_id", "sent_at");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_read_at_idx" ON "notification_logs"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "offline_sync_logs_user_id_created_at_idx" ON "offline_sync_logs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "trade_reviews_trade_id_key" ON "trade_reviews"("trade_id");

-- CreateIndex
CREATE INDEX "trade_reviews_user_id_reviewed_at_idx" ON "trade_reviews"("user_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "review_question_templates_user_id_idx" ON "review_question_templates"("user_id");

-- CreateIndex
CREATE INDEX "reports_user_id_period_start_idx" ON "reports"("user_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "reports_user_id_type_period_start_period_end_key" ON "reports"("user_id", "type", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "report_settings_user_id_key" ON "report_settings"("user_id");

-- CreateIndex
CREATE INDEX "scenarios_user_id_created_at_idx" ON "scenarios"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "monte_carlo_runs_user_id_created_at_idx" ON "monte_carlo_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "economic_events_scheduled_at_idx" ON "economic_events"("scheduled_at");

-- CreateIndex
CREATE INDEX "economic_events_user_id_idx" ON "economic_events"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "economic_events_source_external_id_key" ON "economic_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "trade_event_links_event_id_idx" ON "trade_event_links"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_event_links_trade_id_event_id_key" ON "trade_event_links"("trade_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_watchlists_user_id_key" ON "event_watchlists"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_context_snapshots_trade_id_key" ON "market_context_snapshots"("trade_id");

-- CreateIndex
CREATE INDEX "market_context_snapshots_user_id_idx" ON "market_context_snapshots"("user_id");

-- CreateIndex
CREATE INDEX "market_context_snapshots_instrument_id_timeframe_idx" ON "market_context_snapshots"("instrument_id", "timeframe");

-- CreateIndex
CREATE INDEX "price_candles_instrument_id_timeframe_open_time_idx" ON "price_candles"("instrument_id", "timeframe", "open_time");

-- CreateIndex
CREATE UNIQUE INDEX "price_candles_instrument_id_timeframe_open_time_key" ON "price_candles"("instrument_id", "timeframe", "open_time");

-- CreateIndex
CREATE INDEX "prop_firm_rule_sets_user_id_idx" ON "prop_firm_rule_sets"("user_id");

-- CreateIndex
CREATE INDEX "prop_challenges_user_id_idx" ON "prop_challenges"("user_id");

-- CreateIndex
CREATE INDEX "prop_challenges_account_id_idx" ON "prop_challenges"("account_id");

-- CreateIndex
CREATE INDEX "prop_challenge_phase_results_challenge_id_idx" ON "prop_challenge_phase_results"("challenge_id");

-- CreateIndex
CREATE INDEX "prop_payouts_user_id_idx" ON "prop_payouts"("user_id");

-- CreateIndex
CREATE INDEX "prop_payouts_challenge_id_idx" ON "prop_payouts"("challenge_id");

-- CreateIndex
CREATE INDEX "prop_expenses_user_id_idx" ON "prop_expenses"("user_id");

-- CreateIndex
CREATE INDEX "prop_expenses_challenge_id_idx" ON "prop_expenses"("challenge_id");

-- CreateIndex
CREATE UNIQUE INDEX "prop_alert_states_challenge_id_alert_type_day_key_key" ON "prop_alert_states"("challenge_id", "alert_type", "day_key");

-- CreateIndex
CREATE UNIQUE INDEX "broker_connections_token_hash_key" ON "broker_connections"("token_hash");

-- CreateIndex
CREATE INDEX "broker_connections_user_id_idx" ON "broker_connections"("user_id");

-- CreateIndex
CREATE INDEX "broker_connections_user_id_status_idx" ON "broker_connections"("user_id", "status");

-- CreateIndex
CREATE INDEX "sync_event_logs_user_id_idx" ON "sync_event_logs"("user_id");

-- CreateIndex
CREATE INDEX "sync_event_logs_user_id_received_at_idx" ON "sync_event_logs"("user_id", "received_at");

-- CreateIndex
CREATE INDEX "sync_event_logs_connection_id_idx" ON "sync_event_logs"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_event_logs_user_id_event_id_key" ON "sync_event_logs"("user_id", "event_id");

-- CreateIndex
CREATE INDEX "symbol_mappings_user_id_idx" ON "symbol_mappings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "symbol_mappings_user_id_broker_symbol_key" ON "symbol_mappings"("user_id", "broker_symbol");

-- CreateIndex
CREATE INDEX "magic_number_mappings_user_id_idx" ON "magic_number_mappings"("user_id");

-- CreateIndex
CREATE INDEX "magic_number_mappings_user_id_connection_id_idx" ON "magic_number_mappings"("user_id", "connection_id");

-- CreateIndex
CREATE INDEX "trade_modifications_user_id_idx" ON "trade_modifications"("user_id");

-- CreateIndex
CREATE INDEX "trade_modifications_trade_id_time_idx" ON "trade_modifications"("trade_id", "time");

-- CreateIndex
CREATE INDEX "tool_scenarios_user_id_kind_idx" ON "tool_scenarios"("user_id", "kind");

-- CreateIndex
CREATE INDEX "fx_rates_user_id_idx" ON "fx_rates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_user_id_base_currency_quote_currency_key" ON "fx_rates"("user_id", "base_currency", "quote_currency");

-- CreateIndex
CREATE INDEX "market_session_settings_user_id_kind_idx" ON "market_session_settings"("user_id", "kind");

-- CreateIndex
CREATE INDEX "exit_plans_user_id_idx" ON "exit_plans"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "exposure_alert_settings_user_id_key" ON "exposure_alert_settings"("user_id");

-- CreateIndex
CREATE INDEX "account_equity_snapshots_user_id_time_idx" ON "account_equity_snapshots"("user_id", "time");

-- CreateIndex
CREATE INDEX "account_equity_snapshots_account_id_time_idx" ON "account_equity_snapshots"("account_id", "time");

-- CreateIndex
CREATE INDEX "import_batches_user_id_idx" ON "import_batches"("user_id");

-- CreateIndex
CREATE INDEX "import_batches_user_id_file_hash_idx" ON "import_batches"("user_id", "file_hash");

-- CreateIndex
CREATE INDEX "import_batches_account_id_idx" ON "import_batches"("account_id");

-- CreateIndex
CREATE INDEX "reconciliation_candidates_user_id_status_idx" ON "reconciliation_candidates"("user_id", "status");

-- CreateIndex
CREATE INDEX "reconciliation_candidates_account_id_idx" ON "reconciliation_candidates"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_candidates_manual_trade_id_broker_trade_id_key" ON "reconciliation_candidates"("manual_trade_id", "broker_trade_id");

-- CreateIndex
CREATE INDEX "trade_merge_logs_user_id_idx" ON "trade_merge_logs"("user_id");

-- CreateIndex
CREATE INDEX "trade_merge_logs_surviving_trade_id_idx" ON "trade_merge_logs"("surviving_trade_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");

-- CreateIndex
CREATE INDEX "share_links_user_id_idx" ON "share_links"("user_id");

-- CreateIndex
CREATE INDEX "share_links_user_id_type_idx" ON "share_links"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "mentor_invitations_token_hash_key" ON "mentor_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "mentor_invitations_owner_id_idx" ON "mentor_invitations"("owner_id");

-- CreateIndex
CREATE INDEX "mentor_invitations_invitee_email_idx" ON "mentor_invitations"("invitee_email");

-- CreateIndex
CREATE INDEX "mentor_accesses_mentor_id_idx" ON "mentor_accesses"("mentor_id");

-- CreateIndex
CREATE INDEX "mentor_accesses_owner_id_status_idx" ON "mentor_accesses"("owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mentor_accesses_owner_id_mentor_id_key" ON "mentor_accesses"("owner_id", "mentor_id");

-- CreateIndex
CREATE INDEX "mentor_access_logs_owner_id_idx" ON "mentor_access_logs"("owner_id");

-- CreateIndex
CREATE INDEX "mentor_access_logs_mentor_id_idx" ON "mentor_access_logs"("mentor_id");

-- CreateIndex
CREATE UNIQUE INDEX "mentor_access_logs_owner_id_mentor_id_resource_type_resourc_key" ON "mentor_access_logs"("owner_id", "mentor_id", "resource_type", "resource_id", "day");

-- CreateIndex
CREATE INDEX "trade_comments_trade_id_idx" ON "trade_comments"("trade_id");

-- CreateIndex
CREATE INDEX "trade_comments_owner_id_idx" ON "trade_comments"("owner_id");

-- CreateIndex
CREATE INDEX "trade_comments_author_id_idx" ON "trade_comments"("author_id");

-- CreateIndex
CREATE INDEX "comment_mentions_mentioned_user_id_idx" ON "comment_mentions"("mentioned_user_id");

-- CreateIndex
CREATE INDEX "comment_read_states_user_id_idx" ON "comment_read_states"("user_id");

-- CreateIndex
CREATE INDEX "consent_records_user_id_idx" ON "consent_records"("user_id");

-- CreateIndex
CREATE INDEX "consent_records_user_id_type_idx" ON "consent_records"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_requests_user_id_key" ON "account_deletion_requests"("user_id");

-- CreateIndex
CREATE INDEX "data_export_logs_user_id_idx" ON "data_export_logs"("user_id");

-- CreateIndex
CREATE INDEX "dashboards_user_id_idx" ON "dashboards"("user_id");

-- CreateIndex
CREATE INDEX "dashboard_widgets_user_id_idx" ON "dashboard_widgets"("user_id");

-- CreateIndex
CREATE INDEX "dashboard_widgets_dashboard_id_idx" ON "dashboard_widgets"("dashboard_id");

-- CreateIndex
CREATE INDEX "custom_metrics_user_id_idx" ON "custom_metrics"("user_id");

-- CreateIndex
CREATE INDEX "user_dashboard_templates_user_id_idx" ON "user_dashboard_templates"("user_id");

-- CreateIndex
CREATE INDEX "saved_charts_user_id_idx" ON "saved_charts"("user_id");

-- CreateIndex
CREATE INDEX "chart_annotations_user_id_idx" ON "chart_annotations"("user_id");

-- CreateIndex
CREATE INDEX "chart_annotations_user_id_date_idx" ON "chart_annotations"("user_id", "date");

-- CreateIndex
CREATE INDEX "benchmark_profiles_user_id_idx" ON "benchmark_profiles"("user_id");

-- CreateIndex
CREATE INDEX "keyboard_shortcuts_user_id_idx" ON "keyboard_shortcuts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "keyboard_shortcuts_user_id_action_id_key" ON "keyboard_shortcuts"("user_id", "action_id");

-- CreateIndex
CREATE INDEX "table_column_preferences_user_id_idx" ON "table_column_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "table_column_preferences_user_id_table_key_key" ON "table_column_preferences"("user_id", "table_key");

-- CreateIndex
CREATE INDEX "custom_field_definitions_user_id_entity_idx" ON "custom_field_definitions"("user_id", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_user_id_entity_key_key" ON "custom_field_definitions"("user_id", "entity", "key");

-- CreateIndex
CREATE INDEX "change_logs_user_id_created_at_idx" ON "change_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "change_logs_user_id_group_id_idx" ON "change_logs"("user_id", "group_id");

-- CreateIndex
CREATE INDEX "change_logs_user_id_expires_at_idx" ON "change_logs"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "batch_entry_drafts_user_id_idx" ON "batch_entry_drafts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_entry_drafts_user_id_key" ON "batch_entry_drafts"("user_id");

-- CreateIndex
CREATE INDEX "gaia_notes_user_id_idx" ON "gaia_notes"("user_id");

-- CreateIndex
CREATE INDEX "gaia_notes_user_id_folder_id_idx" ON "gaia_notes"("user_id", "folder_id");

-- CreateIndex
CREATE INDEX "gaia_folders_user_id_idx" ON "gaia_folders"("user_id");

-- CreateIndex
CREATE INDEX "gaia_tags_user_id_idx" ON "gaia_tags"("user_id");

-- CreateIndex
CREATE INDEX "gaia_templates_user_id_idx" ON "gaia_templates"("user_id");

-- CreateIndex
CREATE INDEX "gaia_versions_user_id_note_id_idx" ON "gaia_versions"("user_id", "note_id");

-- CreateIndex
CREATE INDEX "gaia_versions_note_id_saved_at_idx" ON "gaia_versions"("note_id", "saved_at");

-- CreateIndex
CREATE UNIQUE INDEX "trade_lifecycle_stats_trade_id_key" ON "trade_lifecycle_stats"("trade_id");

-- CreateIndex
CREATE INDEX "trade_lifecycle_stats_user_id_computed_at_idx" ON "trade_lifecycle_stats"("user_id", "computed_at");

-- CreateIndex
CREATE INDEX "trader_score_snapshots_user_id_date_idx" ON "trader_score_snapshots"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "trader_score_snapshots_user_id_date_key" ON "trader_score_snapshots"("user_id", "date");

-- CreateIndex
CREATE INDEX "trade_anomalies_user_id_detected_at_idx" ON "trade_anomalies"("user_id", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "trade_anomalies_trade_id_kind_key" ON "trade_anomalies"("trade_id", "kind");

-- CreateIndex
CREATE INDEX "weekly_plan_actions_user_id_week_start_idx" ON "weekly_plan_actions"("user_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_actions_user_id_week_start_rule_key" ON "weekly_plan_actions"("user_id", "week_start", "rule");

-- CreateIndex
CREATE INDEX "integration_endpoints_user_id_idx" ON "integration_endpoints"("user_id");

-- CreateIndex
CREATE INDEX "integration_subscriptions_user_id_idx" ON "integration_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_subscriptions_endpoint_id_event_type_key" ON "integration_subscriptions"("endpoint_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_dedupe_key_key" ON "outbound_messages"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbound_messages_status_next_attempt_at_idx" ON "outbound_messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbound_messages_user_id_created_at_idx" ON "outbound_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setups" ADD CONSTRAINT "setups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setups" ADD CONSTRAINT "setups_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_rules" ADD CONSTRAINT "playbook_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_rules" ADD CONSTRAINT "playbook_rules_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_checklist_items" ADD CONSTRAINT "strategy_checklist_items_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "setups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_id_fkey" FOREIGN KEY ("exit_plan_id") REFERENCES "exit_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_executions" ADD CONSTRAINT "trade_executions_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_screenshots" ADD CONSTRAINT "trade_screenshots_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_screenshots" ADD CONSTRAINT "trade_screenshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_rules" ADD CONSTRAINT "trading_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_rule_violations" ADD CONSTRAINT "trade_rule_violations_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_rule_violations" ADD CONSTRAINT "trade_rule_violations_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "trading_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_templates" ADD CONSTRAINT "trade_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_templates" ADD CONSTRAINT "trade_templates_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_templates" ADD CONSTRAINT "trade_templates_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_logs" ADD CONSTRAINT "offline_sync_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_question_templates" ADD CONSTRAINT "review_question_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monte_carlo_runs" ADD CONSTRAINT "monte_carlo_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economic_events" ADD CONSTRAINT "economic_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_event_links" ADD CONSTRAINT "trade_event_links_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_event_links" ADD CONSTRAINT "trade_event_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "economic_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_watchlists" ADD CONSTRAINT "event_watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_context_snapshots" ADD CONSTRAINT "market_context_snapshots_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_context_snapshots" ADD CONSTRAINT "market_context_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_context_snapshots" ADD CONSTRAINT "market_context_snapshots_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_candles" ADD CONSTRAINT "price_candles_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_firm_rule_sets" ADD CONSTRAINT "prop_firm_rule_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_challenges" ADD CONSTRAINT "prop_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_challenges" ADD CONSTRAINT "prop_challenges_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_challenges" ADD CONSTRAINT "prop_challenges_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "prop_firm_rule_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_challenge_phase_results" ADD CONSTRAINT "prop_challenge_phase_results_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "prop_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_payouts" ADD CONSTRAINT "prop_payouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_payouts" ADD CONSTRAINT "prop_payouts_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "prop_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_expenses" ADD CONSTRAINT "prop_expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_expenses" ADD CONSTRAINT "prop_expenses_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "prop_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prop_alert_states" ADD CONSTRAINT "prop_alert_states_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "prop_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_connections" ADD CONSTRAINT "broker_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_connections" ADD CONSTRAINT "broker_connections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_event_logs" ADD CONSTRAINT "sync_event_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_event_logs" ADD CONSTRAINT "sync_event_logs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "broker_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbol_mappings" ADD CONSTRAINT "symbol_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_number_mappings" ADD CONSTRAINT "magic_number_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_modifications" ADD CONSTRAINT "trade_modifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_modifications" ADD CONSTRAINT "trade_modifications_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_scenarios" ADD CONSTRAINT "tool_scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_session_settings" ADD CONSTRAINT "market_session_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_plans" ADD CONSTRAINT "exit_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exposure_alert_settings" ADD CONSTRAINT "exposure_alert_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_equity_snapshots" ADD CONSTRAINT "account_equity_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_equity_snapshots" ADD CONSTRAINT "account_equity_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_candidates" ADD CONSTRAINT "reconciliation_candidates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_candidates" ADD CONSTRAINT "reconciliation_candidates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_merge_logs" ADD CONSTRAINT "trade_merge_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_invitations" ADD CONSTRAINT "mentor_invitations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_accesses" ADD CONSTRAINT "mentor_accesses_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_accesses" ADD CONSTRAINT "mentor_accesses_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_comments" ADD CONSTRAINT "trade_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_logs" ADD CONSTRAINT "data_export_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_metrics" ADD CONSTRAINT "custom_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_templates" ADD CONSTRAINT "user_dashboard_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_appearances" ADD CONSTRAINT "user_appearances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_charts" ADD CONSTRAINT "saved_charts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_annotations" ADD CONSTRAINT "chart_annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_profiles" ADD CONSTRAINT "benchmark_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyboard_shortcuts" ADD CONSTRAINT "keyboard_shortcuts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_column_preferences" ADD CONSTRAINT "table_column_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_entry_drafts" ADD CONSTRAINT "batch_entry_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_display_preferences" ADD CONSTRAINT "user_display_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gaia_notes" ADD CONSTRAINT "gaia_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gaia_notes" ADD CONSTRAINT "gaia_notes_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "gaia_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gaia_folders" ADD CONSTRAINT "gaia_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gaia_tags" ADD CONSTRAINT "gaia_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gaia_templates" ADD CONSTRAINT "gaia_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gaia_versions" ADD CONSTRAINT "gaia_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gaia_versions" ADD CONSTRAINT "gaia_versions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "gaia_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_lifecycle_stats" ADD CONSTRAINT "trade_lifecycle_stats_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_lifecycle_stats" ADD CONSTRAINT "trade_lifecycle_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trader_score_snapshots" ADD CONSTRAINT "trader_score_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_anomalies" ADD CONSTRAINT "trade_anomalies_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_anomalies" ADD CONSTRAINT "trade_anomalies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_actions" ADD CONSTRAINT "weekly_plan_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_endpoints" ADD CONSTRAINT "integration_endpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_subscriptions" ADD CONSTRAINT "integration_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_subscriptions" ADD CONSTRAINT "integration_subscriptions_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "integration_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "integration_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

