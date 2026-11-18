-- ═════════════════════════════════════════════════════════════════════════════
-- TradeJournal — prisma/rls.sql
-- Row Level Security pour le déploiement production Supabase / PostgreSQL
-- ═════════════════════════════════════════════════════════════════════════════
--
-- RÔLE DE CE FICHIER — défense en profondeur :
--   L'application applique déjà systématiquement un scoping applicatif par
--   `userId` dans ses requêtes Prisma. Les policies ci-dessous ajoutent une
--   seconde barrière, au niveau base de données : même en cas d'oubli du
--   filtre applicatif ou d'un accès direct avec les rôles `anon` /
--   `authenticated`, un utilisateur ne peut lire ou modifier que les lignes
--   qu'il possède.
--
--   ⚠️ La sandbox locale utilise SQLite : SQLite n'a pas de RLS, ce fichier ne
--   s'exécute pas localement (il y est simplement ignoré). En local, le
--   scoping applicatif userId reste la seule — et suffisante — ligne de
--   défense.
--
-- QUAND L'EXÉCUTER :
--   Dans le SQL Editor de Supabase, APRÈS `prisma migrate deploy` (les tables
--   et colonnes doivent exister). Les noms ci-dessous reprennent exactement
--   les `@@map` / `@map` du schéma Prisma (users, auth_sessions, user_id, …).
--   Le script est idempotent : chaque CREATE POLICY est précédé d'un
--   DROP POLICY IF EXISTS, et ALTER TABLE … ENABLE ROW LEVEL SECURITY peut
--   être relancé sans erreur.
--
-- NOTE — RÔLES QUI CONTOURNENT LE RLS :
--   - `service_role` (clé SUPABASE_SERVICE_ROLE_KEY, usage serveur uniquement,
--     ne JAMAIS l'exposer au client) contourne le RLS : réservé aux tâches
--     administratives et aux opérations serveur de confiance.
--   - Le rôle `postgres` utilisé par Prisma (migrations + runtime) est
--     propriétaire des tables : un propriétaire n'est pas soumis au RLS sauf
--     FORCE ROW LEVEL SECURITY (volontairement non posé ici pour ne pas
--     casser Prisma). Sur ce chemin, le scoping applicatif userId reste de
--     mise — c'est bien le principe de la défense en profondeur.
--   - Les rôles `anon` et `authenticated`, eux, sont soumis aux policies
--     ci-dessous : c'est ce accès que le RLS verrouille.
--
-- NOTE DE TYPAGE :
--   `auth.uid()::text` renvoie un `uuid` Supabase alors que les colonnes Prisma
--   `String` (id, user_id) sont typées `text`. Sur le chemin Supabase, ces
--   colonnes doivent donc contenir l'UUID de auth.users sous forme de texte.
--   Si Postgres remonte « operator does not exist: text = uuid », suffixer
--   auth.uid()::text d'un cast (ex. : user_id = auth.uid()::text).

-- ═════════════════════════════════════════════════════════════════════════════
-- users
-- ═════════════════════════════════════════════════════════════════════════════
-- Sur Supabase, les identités vivent dans auth.users (géré par Supabase Auth).
-- Cette table publique `users` sert de miroir applicatif (email, hash de mot
-- de passe pour la sandbox locale, point d'ancrage des relations Prisma).
-- On pose quand même les policies pour cohérence : un utilisateur ne voit
-- que sa propre ligne de miroir.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users
  FOR SELECT
  USING (id = auth.uid()::text);

DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users
  FOR INSERT
  WITH CHECK (id = auth.uid()::text);

DROP POLICY IF EXISTS users_update ON users;
CREATE POLICY users_update ON users
  FOR UPDATE
  USING (id = auth.uid()::text)
  WITH CHECK (id = auth.uid()::text);

DROP POLICY IF EXISTS users_delete ON users;
CREATE POLICY users_delete ON users
  FOR DELETE
  USING (id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- auth_sessions
-- ═════════════════════════════════════════════════════════════════════════════
-- Sessions serveur (le cookie httpOnly ne contient que l'id de session
-- opaque). Scoping direct : user_id.
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_sessions_select ON auth_sessions;
CREATE POLICY auth_sessions_select ON auth_sessions
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS auth_sessions_insert ON auth_sessions;
CREATE POLICY auth_sessions_insert ON auth_sessions
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS auth_sessions_update ON auth_sessions;
CREATE POLICY auth_sessions_update ON auth_sessions
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS auth_sessions_delete ON auth_sessions;
CREATE POLICY auth_sessions_delete ON auth_sessions
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- profiles
-- ═════════════════════════════════════════════════════════════════════════════
-- Profil 1:1 créé à l'inscription — profiles.id === users.id.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT
  USING (id = auth.uid()::text);

DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles
  FOR INSERT
  WITH CHECK (id = auth.uid()::text);

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE
  USING (id = auth.uid()::text)
  WITH CHECK (id = auth.uid()::text);

DROP POLICY IF EXISTS profiles_delete ON profiles;
CREATE POLICY profiles_delete ON profiles
  FOR DELETE
  USING (id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- accounts
-- ═════════════════════════════════════════════════════════════════════════════
-- Comptes de trading (LIVE | DEMO | PROP | BACKTEST). Scoping : user_id.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS accounts_insert ON accounts;
CREATE POLICY accounts_insert ON accounts
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS accounts_update ON accounts;
CREATE POLICY accounts_update ON accounts
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS accounts_delete ON accounts;
CREATE POLICY accounts_delete ON accounts
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- cash_transactions
-- ═════════════════════════════════════════════════════════════════════════════
-- Dépôts / retraits (pour ne jamais compter les flux comme de la performance).
-- Scoping : user_id.
ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_transactions_select ON cash_transactions;
CREATE POLICY cash_transactions_select ON cash_transactions
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS cash_transactions_insert ON cash_transactions;
CREATE POLICY cash_transactions_insert ON cash_transactions
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS cash_transactions_update ON cash_transactions;
CREATE POLICY cash_transactions_update ON cash_transactions
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS cash_transactions_delete ON cash_transactions;
CREATE POLICY cash_transactions_delete ON cash_transactions
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- instruments
-- ═════════════════════════════════════════════════════════════════════════════
-- user_id NULLABLE : null = preset global (seed), sinon instrument personnel.
--   SELECT : ses propres instruments OU les presets globaux (user_id IS NULL).
--   INSERT / UPDATE / DELETE : uniquement ses propres instruments —
--   impossible de créer, modifier ou supprimer un preset global.
ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instruments_select ON instruments;
CREATE POLICY instruments_select ON instruments
  FOR SELECT
  USING (user_id = auth.uid()::text OR user_id IS NULL);

DROP POLICY IF EXISTS instruments_insert ON instruments;
CREATE POLICY instruments_insert ON instruments
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS instruments_update ON instruments;
CREATE POLICY instruments_update ON instruments
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS instruments_delete ON instruments;
CREATE POLICY instruments_delete ON instruments
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- strategies
-- ═════════════════════════════════════════════════════════════════════════════
-- Stratégies de trading. Scoping : user_id.
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategies_select ON strategies;
CREATE POLICY strategies_select ON strategies
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS strategies_insert ON strategies;
CREATE POLICY strategies_insert ON strategies
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS strategies_update ON strategies;
CREATE POLICY strategies_update ON strategies
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS strategies_delete ON strategies;
CREATE POLICY strategies_delete ON strategies
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- strategy_checklist_items
-- ═════════════════════════════════════════════════════════════════════════════
-- Pas de colonne user_id : la propriété est héritée via la stratégie parente
-- (strategy_id). Le WITH CHECK de insert/update empêche de « re-parenter » un
-- item vers une stratégie appartenant à un autre utilisateur.
ALTER TABLE strategy_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_checklist_items_select ON strategy_checklist_items;
CREATE POLICY strategy_checklist_items_select ON strategy_checklist_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_checklist_items.strategy_id
        AND s.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS strategy_checklist_items_insert ON strategy_checklist_items;
CREATE POLICY strategy_checklist_items_insert ON strategy_checklist_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_checklist_items.strategy_id
        AND s.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS strategy_checklist_items_update ON strategy_checklist_items;
CREATE POLICY strategy_checklist_items_update ON strategy_checklist_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_checklist_items.strategy_id
        AND s.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_checklist_items.strategy_id
        AND s.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS strategy_checklist_items_delete ON strategy_checklist_items;
CREATE POLICY strategy_checklist_items_delete ON strategy_checklist_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_checklist_items.strategy_id
        AND s.user_id = auth.uid()::text
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- trades
-- ═════════════════════════════════════════════════════════════════════════════
-- Table centrale du journal. Scoping : user_id.
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trades_select ON trades;
CREATE POLICY trades_select ON trades
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trades_insert ON trades;
CREATE POLICY trades_insert ON trades
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trades_update ON trades;
CREATE POLICY trades_update ON trades
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trades_delete ON trades;
CREATE POLICY trades_delete ON trades
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- trade_executions
-- ═════════════════════════════════════════════════════════════════════════════
-- Exécutions partielles (entrées échelonnées / sorties partielles). Pas de
-- colonne user_id : propriété héritée via le trade parent (trade_id).
ALTER TABLE trade_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_executions_select ON trade_executions;
CREATE POLICY trade_executions_select ON trade_executions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_executions.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_executions_insert ON trade_executions;
CREATE POLICY trade_executions_insert ON trade_executions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_executions.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_executions_update ON trade_executions;
CREATE POLICY trade_executions_update ON trade_executions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_executions.trade_id
        AND t.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_executions.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_executions_delete ON trade_executions;
CREATE POLICY trade_executions_delete ON trade_executions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_executions.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- tags
-- ═════════════════════════════════════════════════════════════════════════════
-- user_id NULLABLE : null = preset global (ex. tags de mistakes par défaut),
-- sinon tag personnel. Même logique qu'instruments :
--   SELECT : ses propres tags OU les presets globaux (user_id IS NULL).
--   INSERT / UPDATE / DELETE : uniquement ses propres tags.
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tags_select ON tags;
CREATE POLICY tags_select ON tags
  FOR SELECT
  USING (user_id = auth.uid()::text OR user_id IS NULL);

DROP POLICY IF EXISTS tags_insert ON tags;
CREATE POLICY tags_insert ON tags
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS tags_update ON tags;
CREATE POLICY tags_update ON tags
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS tags_delete ON tags;
CREATE POLICY tags_delete ON tags
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- trade_tags
-- ═════════════════════════════════════════════════════════════════════════════
-- Table de jointure (PK composite trade_id + tag_id). Pas de colonne user_id :
-- propriété héritée via le trade parent (trade_id).
-- Remarque : la propriété du tag lui-même (tag_id → tags) n'est pas revérifiée
-- ici — la jointure est contrôlée côté applicatif ; renforcer avec un second
-- EXISTS sur tags si besoin.
ALTER TABLE trade_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_tags_select ON trade_tags;
CREATE POLICY trade_tags_select ON trade_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_tags.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_tags_insert ON trade_tags;
CREATE POLICY trade_tags_insert ON trade_tags
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_tags.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_tags_update ON trade_tags;
CREATE POLICY trade_tags_update ON trade_tags
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_tags.trade_id
        AND t.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_tags.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_tags_delete ON trade_tags;
CREATE POLICY trade_tags_delete ON trade_tags
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM trades t
      WHERE t.id = trade_tags.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- trade_screenshots
-- ═════════════════════════════════════════════════════════════════════════════
-- Captures d'écran rattachées à un trade. Scoping direct : user_id (la table
-- porte aussi trade_id, redondance volontaire pour le scoping).
ALTER TABLE trade_screenshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_screenshots_select ON trade_screenshots;
CREATE POLICY trade_screenshots_select ON trade_screenshots
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trade_screenshots_insert ON trade_screenshots;
CREATE POLICY trade_screenshots_insert ON trade_screenshots
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trade_screenshots_update ON trade_screenshots;
CREATE POLICY trade_screenshots_update ON trade_screenshots
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trade_screenshots_delete ON trade_screenshots;
CREATE POLICY trade_screenshots_delete ON trade_screenshots
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- journal_entries
-- ═════════════════════════════════════════════════════════════════════════════
-- Journal quotidien (date au fuseau de l'utilisateur). Scoping : user_id.
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_entries_select ON journal_entries;
CREATE POLICY journal_entries_select ON journal_entries
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS journal_entries_insert ON journal_entries;
CREATE POLICY journal_entries_insert ON journal_entries
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS journal_entries_update ON journal_entries;
CREATE POLICY journal_entries_update ON journal_entries
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS journal_entries_delete ON journal_entries;
CREATE POLICY journal_entries_delete ON journal_entries
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- trading_rules
-- ═════════════════════════════════════════════════════════════════════════════
-- Règles personnelles (max trades/jour, perte max quotidienne, …). Scoping :
-- user_id.
ALTER TABLE trading_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trading_rules_select ON trading_rules;
CREATE POLICY trading_rules_select ON trading_rules
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trading_rules_insert ON trading_rules;
CREATE POLICY trading_rules_insert ON trading_rules
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trading_rules_update ON trading_rules;
CREATE POLICY trading_rules_update ON trading_rules
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trading_rules_delete ON trading_rules;
CREATE POLICY trading_rules_delete ON trading_rules
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- strategy_versions (addendum §11.3)
-- ═════════════════════════════════════════════════════════════════════════════
-- Snapshots immuables de stratégies. Pas de colonne user_id : propriété héritée
-- via la stratégie parente (strategy_id). Le WITH CHECK empêche de re-parenter un
-- snapshot vers la stratégie d'un autre utilisateur.
ALTER TABLE strategy_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_versions_select ON strategy_versions;
CREATE POLICY strategy_versions_select ON strategy_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_versions.strategy_id
        AND s.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS strategy_versions_insert ON strategy_versions;
CREATE POLICY strategy_versions_insert ON strategy_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_versions.strategy_id
        AND s.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS strategy_versions_delete ON strategy_versions;
CREATE POLICY strategy_versions_delete ON strategy_versions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM strategies s
      WHERE s.id = strategy_versions.strategy_id
        AND s.user_id = auth.uid()::text
    )
  );
-- NB : pas de policy UPDATE — les snapshots sont immuables par conception.

-- ═════════════════════════════════════════════════════════════════════════════
-- saved_views (addendum §11.3)
-- ═════════════════════════════════════════════════════════════════════════════
-- Vues de filtres nommées par page. Scoping : user_id.
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_views_select ON saved_views;
CREATE POLICY saved_views_select ON saved_views
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS saved_views_insert ON saved_views;
CREATE POLICY saved_views_insert ON saved_views
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS saved_views_update ON saved_views;
CREATE POLICY saved_views_update ON saved_views
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS saved_views_delete ON saved_views;
CREATE POLICY saved_views_delete ON saved_views
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- goals (addendum §11.4 — phase 6)
-- ═════════════════════════════════════════════════════════════════════════════
-- Objectifs mesurables avec progression dashboard. Scoping : user_id.
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goals_select ON goals;
CREATE POLICY goals_select ON goals
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS goals_insert ON goals;
CREATE POLICY goals_insert ON goals
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS goals_update ON goals;
CREATE POLICY goals_update ON goals
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS goals_delete ON goals;
CREATE POLICY goals_delete ON goals
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- trade_rule_violations (addendum §11.4 — phase 6)
-- ═════════════════════════════════════════════════════════════════════════════
-- Violations de règles attachées à un trade. Propriété doublement héritée :
-- via le trade parent (trade_id) ET via la règle (rule_id) — les deux EXISTS
-- garantissent qu'on ne peut lier que SES trades à SES règles.
ALTER TABLE trade_rule_violations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_rule_violations_select ON trade_rule_violations;
CREATE POLICY trade_rule_violations_select ON trade_rule_violations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trades t
      WHERE t.id = trade_rule_violations.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_rule_violations_insert ON trade_rule_violations;
CREATE POLICY trade_rule_violations_insert ON trade_rule_violations
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trades t
      WHERE t.id = trade_rule_violations.trade_id
        AND t.user_id = auth.uid()::text
    )
    AND EXISTS (
      SELECT 1 FROM trading_rules r
      WHERE r.id = trade_rule_violations.rule_id
        AND r.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS trade_rule_violations_delete ON trade_rule_violations;
CREATE POLICY trade_rule_violations_delete ON trade_rule_violations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM trades t
      WHERE t.id = trade_rule_violations.trade_id
        AND t.user_id = auth.uid()::text
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- Storage — bucket privé 'trade-screenshots'
-- ═════════════════════════════════════════════════════════════════════════════
-- Les fichiers vivent sous {userId}/{tradeId}/<fichier> dans un bucket PRIVÉ
-- (public = false) : l'accès passe par les policies ci-dessous (ou des URLs
-- signées côté serveur). Chaque policy isole l'utilisateur au premier dossier
-- du chemin : (storage.foldername(name))[1] = auth.uid()::text.
-- NB : storage.objects a déjà le RLS activé par Supabase — on se contente
-- d'ajouter nos policies (idempotentes grâce au DROP POLICY IF EXISTS).
INSERT INTO storage.buckets (id, name, public)
VALUES ('trade-screenshots', 'trade-screenshots', false)
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS trade_screenshots_select ON storage.objects;
CREATE POLICY trade_screenshots_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'trade-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS trade_screenshots_insert ON storage.objects;
CREATE POLICY trade_screenshots_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'trade-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS trade_screenshots_update ON storage.objects;
CREATE POLICY trade_screenshots_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'trade-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'trade-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS trade_screenshots_delete ON storage.objects;
CREATE POLICY trade_screenshots_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'trade-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- v3 — Broker sync & import (owner-only, sauf lecture mentor via helpers)
-- ═════════════════════════════════════════════════════════════════════════════
-- Toutes les tables v3 appartiennent à un utilisateur (user_id) et suivent le
-- même motif owner-only. L'accès mentor en lecture est accordé UNIQUEMENT via
-- les fonctions SECURITY DEFINER app.mentor_* ci-dessous (jamais via des
-- policies directes : un mentor ne doit jamais écrire les données du
-- propriétaire, et ne doit lire que ce que son scope autorise).
--
-- Tables owner-only (aucun accès mentor direct) :
--   broker_connections, sync_event_logs, symbol_mappings,
--   magic_number_mappings, account_equity_snapshots, import_batches,
--   reconciliation_candidates, trade_merge_logs, share_links,
--   mentor_invitations, mentor_accesses (le mentor ne voit que SES accès via
--   mentor_id), mentor_access_logs, comment_mentions, comment_read_states,
--   consent_records, account_deletion_requests, data_export_logs.
-- Tables avec lecture mentor possible : trade_modifications, trade_comments
-- (écriture réservée : commentaires créés sous leur propre author_id —
-- géré applicativement, l'application n'utilise pas le rôle anon pour écrire).

ALTER TABLE broker_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS broker_connections_owner ON broker_connections;
CREATE POLICY broker_connections_owner ON broker_connections
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE sync_event_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_event_logs_owner ON sync_event_logs;
CREATE POLICY sync_event_logs_owner ON sync_event_logs
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE symbol_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS symbol_mappings_owner ON symbol_mappings;
CREATE POLICY symbol_mappings_owner ON symbol_mappings
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE magic_number_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS magic_number_mappings_owner ON magic_number_mappings;
CREATE POLICY magic_number_mappings_owner ON magic_number_mappings
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE trade_modifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_modifications_owner ON trade_modifications;
CREATE POLICY trade_modifications_owner ON trade_modifications
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS trade_modifications_mentor_select ON trade_modifications;
CREATE POLICY trade_modifications_mentor_select ON trade_modifications
  FOR SELECT
  USING (app.mentor_can_read_trade(trade_id));

ALTER TABLE account_equity_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_equity_snapshots_owner ON account_equity_snapshots;
CREATE POLICY account_equity_snapshots_owner ON account_equity_snapshots
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_batches_owner ON import_batches;
CREATE POLICY import_batches_owner ON import_batches
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE reconciliation_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reconciliation_candidates_owner ON reconciliation_candidates;
CREATE POLICY reconciliation_candidates_owner ON reconciliation_candidates
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE trade_merge_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_merge_logs_owner ON trade_merge_logs;
CREATE POLICY trade_merge_logs_owner ON trade_merge_logs
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- v3 — Sharing & collaboration
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS share_links_owner ON share_links;
CREATE POLICY share_links_owner ON share_links
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE mentor_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mentor_invitations_owner ON mentor_invitations;
CREATE POLICY mentor_invitations_owner ON mentor_invitations
  FOR ALL
  USING (owner_id = auth.uid()::text)
  WITH CHECK (owner_id = auth.uid()::text);

ALTER TABLE mentor_accesses ENABLE ROW LEVEL SECURITY;
-- Le propriétaire gère l'accès ; le mentor voit uniquement SES accès reçus
-- (jamais les accès des autres mentors du propriétaire).
DROP POLICY IF EXISTS mentor_accesses_owner ON mentor_accesses;
CREATE POLICY mentor_accesses_owner ON mentor_accesses
  FOR ALL
  USING (owner_id = auth.uid()::text)
  WITH CHECK (owner_id = auth.uid()::text);

DROP POLICY IF EXISTS mentor_accesses_mentor_select ON mentor_accesses;
CREATE POLICY mentor_accesses_mentor_select ON mentor_accesses
  FOR SELECT
  USING (mentor_id = auth.uid()::text);

ALTER TABLE mentor_access_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mentor_access_logs_owner ON mentor_access_logs;
CREATE POLICY mentor_access_logs_owner ON mentor_access_logs
  FOR ALL
  USING (owner_id = auth.uid()::text)
  WITH CHECK (owner_id = auth.uid()::text);

ALTER TABLE trade_comments ENABLE ROW LEVEL SECURITY;
-- Le propriétaire du journal voit tout ; un auteur voit ses propres
-- commentaires ; un mentor avec canComment peut insérer SOUS SON PROPRE id
-- (WITH CHECK author_id) — jamais modifier/supprimer ceux des autres.
DROP POLICY IF EXISTS trade_comments_owner ON trade_comments;
CREATE POLICY trade_comments_owner ON trade_comments
  FOR ALL
  USING (owner_id = auth.uid()::text)
  WITH CHECK (owner_id = auth.uid()::text);

DROP POLICY IF EXISTS trade_comments_mentor_select ON trade_comments;
CREATE POLICY trade_comments_mentor_select ON trade_comments
  FOR SELECT
  USING (app.mentor_can_read_trade(trade_id));

DROP POLICY IF EXISTS trade_comments_author ON trade_comments;
CREATE POLICY trade_comments_author ON trade_comments
  FOR SELECT
  USING (author_id = auth.uid()::text);

DROP POLICY IF EXISTS trade_comments_author_insert ON trade_comments;
CREATE POLICY trade_comments_author_insert ON trade_comments
  FOR INSERT
  WITH CHECK (
    author_id = auth.uid()::text
    AND app.mentor_can_read_trade(trade_id)
  );

DROP POLICY IF EXISTS trade_comments_author_update ON trade_comments;
CREATE POLICY trade_comments_author_update ON trade_comments
  FOR UPDATE
  USING (author_id = auth.uid()::text)
  WITH CHECK (author_id = auth.uid()::text);

ALTER TABLE comment_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_mentions_mentioned ON comment_mentions;
CREATE POLICY comment_mentions_mentioned ON comment_mentions
  FOR SELECT
  USING (mentioned_user_id = auth.uid()::text);

ALTER TABLE comment_read_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_read_states_owner ON comment_read_states;
CREATE POLICY comment_read_states_owner ON comment_read_states
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- v3 — Fonctions mentor SECURITY DEFINER (lecture scope-bounded)
-- ═════════════════════════════════════════════════════════════════════════════
-- Ces fonctions reproduisent les règles de scope applicatives (AccessContext)
-- au niveau SQL : un mentor actif, non expiré, dont le scope couvre le COMPTE
-- du trade, peut le lire. Elles alimentent les policies SELECT mentor des
-- tables trades / trade_modifications / trade_comments. Les mentors n'obtiennent
-- JAMAIS de droit d'écriture sur les données du propriétaire via le SQL.

CREATE OR REPLACE FUNCTION app.mentor_can_read_trade(p_trade_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM trades t
    JOIN mentor_accesses ma ON ma.owner_id = t.user_id
    WHERE t.id = p_trade_id
      AND ma.mentor_id = auth.uid()::text
      AND ma.status = 'ACTIVE'
      AND (ma.expires_at IS NULL OR ma.expires_at > now())
      AND (
        ma.account_scope = 'ALL'
        OR (
          ma.account_scope = 'LIST'
          AND t.account_id::text = ANY (
            SELECT jsonb_array_elements_text(ma.account_ids_json::jsonb)
          )
        )
      )
  );
$$;

-- Équivalent pour une entrée de journal (scope comptes + can_view_journal).
CREATE OR REPLACE FUNCTION app.mentor_can_read_journal(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM journal_entries je
    JOIN mentor_accesses ma ON ma.owner_id = je.user_id
    WHERE je.id = p_entry_id
      AND ma.mentor_id = auth.uid()::text
      AND ma.status = 'ACTIVE'
      AND (ma.expires_at IS NULL OR ma.expires_at > now())
      AND ma.can_view_journal
      AND (
        ma.account_scope = 'ALL'
        OR ma.account_scope = 'LIST'  -- journal non lié à un compte : LIST = refusé
      )
  );
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- v3 — Compliance
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consent_records_owner ON consent_records;
CREATE POLICY consent_records_owner ON consent_records
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_deletion_requests_owner ON account_deletion_requests;
CREATE POLICY account_deletion_requests_owner ON account_deletion_requests
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE data_export_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_export_logs_owner ON data_export_logs;
CREATE POLICY data_export_logs_owner ON data_export_logs
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- rate_limit_buckets / deleted_user_tombstones : service-role uniquement
-- (aucune policy anon/authenticated — accès impossible côté client direct).
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE deleted_user_tombstones ENABLE ROW LEVEL SECURITY;

-- ═════════════════════════════════════════════════════════════════════════════
-- v2.5 Module 4 — Productivity & ergonomics
-- ═════════════════════════════════════════════════════════════════════════════

-- Soft-deleted rows stay owner-scoped; the deleted_at filter is enforced by the
-- Prisma client extension (sandbox) / views + policies (documented upgrade path).
ALTER TABLE keyboard_shortcuts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS keyboard_shortcuts_owner ON keyboard_shortcuts;
CREATE POLICY keyboard_shortcuts_owner ON keyboard_shortcuts
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE table_column_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS table_column_preferences_owner ON table_column_preferences;
CREATE POLICY table_column_preferences_owner ON table_column_preferences
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custom_field_definitions_owner ON custom_field_definitions;
CREATE POLICY custom_field_definitions_owner ON custom_field_definitions
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE change_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS change_logs_owner ON change_logs;
CREATE POLICY change_logs_owner ON change_logs
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE batch_entry_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS batch_entry_drafts_owner ON batch_entry_drafts;
CREATE POLICY batch_entry_drafts_owner ON batch_entry_drafts
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- Gaïa — workspace de notes
-- ═════════════════════════════════════════════════════════════════════════════
-- Modèle trades : une policy par opération, scoping par user_id = auth.uid()::text.
-- Les lignes en corbeille (deleted_at non nul) restent scopées au propriétaire ;
-- le filtre deleted_at est appliqué par le code serveur (src/server/gaia.ts).

-- gaia_notes
ALTER TABLE gaia_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gaia_notes_select ON gaia_notes;
CREATE POLICY gaia_notes_select ON gaia_notes
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_notes_insert ON gaia_notes;
CREATE POLICY gaia_notes_insert ON gaia_notes
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_notes_update ON gaia_notes;
CREATE POLICY gaia_notes_update ON gaia_notes
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_notes_delete ON gaia_notes;
CREATE POLICY gaia_notes_delete ON gaia_notes
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- gaia_folders
ALTER TABLE gaia_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gaia_folders_select ON gaia_folders;
CREATE POLICY gaia_folders_select ON gaia_folders
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_folders_insert ON gaia_folders;
CREATE POLICY gaia_folders_insert ON gaia_folders
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_folders_update ON gaia_folders;
CREATE POLICY gaia_folders_update ON gaia_folders
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_folders_delete ON gaia_folders;
CREATE POLICY gaia_folders_delete ON gaia_folders
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- gaia_tags
ALTER TABLE gaia_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gaia_tags_select ON gaia_tags;
CREATE POLICY gaia_tags_select ON gaia_tags
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_tags_insert ON gaia_tags;
CREATE POLICY gaia_tags_insert ON gaia_tags
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_tags_update ON gaia_tags;
CREATE POLICY gaia_tags_update ON gaia_tags
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_tags_delete ON gaia_tags;
CREATE POLICY gaia_tags_delete ON gaia_tags
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- gaia_templates
ALTER TABLE gaia_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gaia_templates_select ON gaia_templates;
CREATE POLICY gaia_templates_select ON gaia_templates
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_templates_insert ON gaia_templates;
CREATE POLICY gaia_templates_insert ON gaia_templates
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_templates_update ON gaia_templates;
CREATE POLICY gaia_templates_update ON gaia_templates
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_templates_delete ON gaia_templates;
CREATE POLICY gaia_templates_delete ON gaia_templates
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- gaia_versions
ALTER TABLE gaia_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gaia_versions_select ON gaia_versions;
CREATE POLICY gaia_versions_select ON gaia_versions
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_versions_insert ON gaia_versions;
CREATE POLICY gaia_versions_insert ON gaia_versions
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_versions_update ON gaia_versions;
CREATE POLICY gaia_versions_update ON gaia_versions
  FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS gaia_versions_delete ON gaia_versions;
CREATE POLICY gaia_versions_delete ON gaia_versions
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- v2.5 Module 5 — trading tools (scoping : user_id)
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE tool_scenarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_scenarios_owner ON tool_scenarios;
CREATE POLICY tool_scenarios_owner ON tool_scenarios
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_rates_owner ON fx_rates;
CREATE POLICY fx_rates_owner ON fx_rates
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE market_session_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_session_settings_owner ON market_session_settings;
CREATE POLICY market_session_settings_owner ON market_session_settings
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE exit_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exit_plans_owner ON exit_plans;
CREATE POLICY exit_plans_owner ON exit_plans
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE exposure_alert_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exposure_alert_settings_owner ON exposure_alert_settings;
CREATE POLICY exposure_alert_settings_owner ON exposure_alert_settings
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- v2.5 Module 6 — advanced analytics (Prompt 6)
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE trade_lifecycle_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_lifecycle_stats_owner ON trade_lifecycle_stats;
CREATE POLICY trade_lifecycle_stats_owner ON trade_lifecycle_stats
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE trader_score_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_score_snapshots_owner ON trader_score_snapshots;
CREATE POLICY trader_score_snapshots_owner ON trader_score_snapshots
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE trade_anomalies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_anomalies_owner ON trade_anomalies;
CREATE POLICY trade_anomalies_owner ON trade_anomalies
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ── Weekly improvement plan (MRT wave 1) ────────────────────────────────────

ALTER TABLE weekly_plan_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weekly_plan_actions_owner ON weekly_plan_actions;
CREATE POLICY weekly_plan_actions_owner ON weekly_plan_actions
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- v2.5 Module 9 — Discord / Telegram integrations (Prompt 9)
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE integration_endpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_endpoints_owner ON integration_endpoints;
CREATE POLICY integration_endpoints_owner ON integration_endpoints
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE integration_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_subscriptions_owner ON integration_subscriptions;
CREATE POLICY integration_subscriptions_owner ON integration_subscriptions
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbound_messages_owner ON outbound_messages;
CREATE POLICY outbound_messages_owner ON outbound_messages
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════════
-- Phase 2 — Playbook (setups, playbook rules, checklist templates)
-- ═════════════════════════════════════════════════════════════════════════════
-- All three tables carry user_id directly (same pattern as strategies).

ALTER TABLE setups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS setups_owner ON setups;
CREATE POLICY setups_owner ON setups
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE playbook_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playbook_rules_owner ON playbook_rules;
CREATE POLICY playbook_rules_owner ON playbook_rules
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_templates_owner ON checklist_templates;
CREATE POLICY checklist_templates_owner ON checklist_templates
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);
