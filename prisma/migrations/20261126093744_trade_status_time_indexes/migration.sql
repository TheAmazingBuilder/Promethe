-- Chantier 3 - composite indexes on Trade for the two hot query shapes:
-- (userId, status, exitTime) serves every CLOSED-trades-in-a-period read
-- (calendar month/day/year, monthly reports, dashboard closed dataset,
-- advanced analytics and analytics period cutoffs, balance-at-time), and
-- (userId, status, entryTime) serves the entry-time range reads
-- (playbook setup performance since a date, pre-trade warnings and
-- trading-rule daily counts, prop evaluation open trades in a phase).
-- The existing single-column-prefix indexes ([userId, entryTime] and
-- [userId, status]) are kept: neither composite covers a bare
-- (userId, entryTime) range, and removing them is out of scope.
-- No data rows are created by this migration.
CREATE INDEX "trades_user_id_status_exit_time_idx" ON "trades"("user_id", "status", "exit_time");

CREATE INDEX "trades_user_id_status_entry_time_idx" ON "trades"("user_id", "status", "entry_time");
