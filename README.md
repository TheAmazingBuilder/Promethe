# TradeJournal — Journal de trading & analytique de stratégies

Application web multi-utilisateur de journal de trading, conçue pour un trader
principal actif sur **XAUUSD (or)** et **Forex** : pips, points, lots, tailles de
contrat et devises de cotation gérés avec une précision décimale exacte.

> Construit phase par phase. La feuille de route et l'état courant sont affichés
> sur la page d'accueil.

## Stack technique (adaptée à l'environnement sandbox)

| Demande initiale | Implémentation | Raison |
|---|---|---|
| Next.js 15 (App Router) | **Next.js 16 (App Router)** | Imposé par l'environnement — App Router et RSC identiques |
| Supabase PostgreSQL | **Prisma + SQLite** | Une seule base disponible dans la sandbox ; le schéma reste portable vers Postgres (colonnes snake_case, types standards) |
| Supabase Auth (+ Google OAuth) | **Auth maison** : cookie httpOnly + sessions serveur + hachage scrypt | Pas d'API Google disponible ; modèle `User` + `AuthSession` déjà en place. Google OAuth ajoutable plus tard en fournisseur |
| RLS Postgres (`userId = auth.uid()`) | **Scoping `userId` systématique** dans la couche d'accès données (`/src/server/*`, helper `requireUser()`) | SQLite n'a pas de RLS ; la défense en profondeur est assurée au niveau applicatif — aucune requête Prisma ne s'exécute sans `userId` vérifié |
| Supabase Storage | **Stockage local** `/uploads/{userId}/…` + table `TradeScreenshot` | Équivalent fonctionnel dans la sandbox |
| Server Actions | **API Routes** (`/src/app/api/*`) | Imposé par l'environnement |
| Multi-pages (`/trades`, `/analytics`…) | **Single-route SPA** avec routing hash (`#/trades`, `#/trades/[id]`…) | Une seule route visible dans la sandbox ; le routing client offre la même UX (deep links, bouton retour) |
| Vitest | **Vitest** (ajouté — addendum §11.8) | DB de test dédiée `db/test.db` (jamais la DB de dev) ; 357 tests : moteur, exécutions, sessions UTC, auth, **isolation inter-utilisateurs** |

Le reste de la stack demandée est en place : TypeScript strict, Tailwind CSS +
shadcn/ui + lucide-react, dark mode (next-themes), recharts, zod, React Hook
Form, TanStack Table, date-fns.

## Addendum §11 — intégration (récapitulatif des décisions)

| Exigence | Décision |
|---|---|
| Versions latest stables | Next 16.1, Prisma 6.19, next-intl 4.15, Zod 4, React 19 — rien d'épinglé vieux |
| RLS presets globaux | Déjà conforme (`instruments`/`tags` : SELECT presets autorisé, écriture réservée au propriétaire) ; policies ajoutées pour les 4 nouvelles tables (`strategy_versions` sans UPDATE — snapshots immuables) |
| `StrategyVersion`, `SavedView`, `Trade.reviewStatus`/`isDraft` | Ajoutés au schéma AVANT la phase 3 (pas de migration cassante) ; autosave de brouillon = `Trade` avec `isDraft = true` (phase 3) |
| Goals/Rules en phase 6 | Modèles `Goal` + `TradeRuleViolation` créés dès maintenant, détection de violations + progression dashboard livrés en phase 6 |
| Champs PROP + widget risque de breach | Champs ajoutés à `Account` ; le widget arrive avec le dashboard analytique (phase 5/6) |
| i18n FR/EN dès le jour 1 | Voir section dédiée ci-dessus — fait et vérifié au navigateur |
| Compression client 1600px WebP q0.8 | Intégrée à l'upload des captures en phase 3 (canvas → WebP avant l'envoi) |
| Tests : DB séparée + isolation | Fait (section Tests) — l'isolation A/B est prouvée par test automatisé |
| README : pause Supabase ~7 j + Vercel Hobby non commercial | Ajouté à la section Déploiement (phase 7) |

## Conventions financières (décisions documentées)

- **Decimal partout** : tout montant, prix, lot, pip est un `Prisma.Decimal`
  (decimal.js). Aucun calcul monétaire en `float`. À la frontière DB, les
  décimaux passent par des chaînes (round-trip exact).
- **Pip XAUUSD = 0.10** par défaut (convention standard : 2345.00 → 2345.10 =
  1 pip). Certains brokers comptent 0.01 : `pipSize` est **configurable par
  instrument** et la convention est documentée dans l'UI.
- **Coûts signés** : `commission`, `swap`, `fees` sont des coûts signés dans la
  devise du compte (positif = coût, négatif = crédit).
  `netPnl = grossPnl − (commission + swap + fees)`.
- **P&L brut en devise de cotation**, converti en devise du compte via
  `quoteToAccountRate` si fourni. Si quote ≠ compte → résultat **ESTIMATE** ;
  le P&L réel saisi du broker (`pnlSource = MANUAL`) prime toujours.
- **R multiple** : basé sur le **stop initial** (`initialStopLoss`).
  `realizedRR` = netPnl / risque initial (coûts inclus).
- **Sessions (UTC, sans DST)** : Asie 00h–07h · Londres 07h–12h · Overlap
  12h–16h · New York 16h–21h · Autre 21h–24h. L'overlap est prioritaire.
- **Temps stockés en UTC**, affichés dans le fuseau du profil.
  `JournalEntry.date` = `YYYY-MM-DD` **dans le fuseau utilisateur** (évite la
  dérive UTC d'un jour calendaire).
- **Arrondi de position** : lots arrondis **au pas inférieur** (0.01 par
  défaut) — le risque réel ne dépasse jamais le risque demandé.
- **Classification** : WIN/LOSS/BREAKEVEN, neutre si |R| ≤ 0.1R (seuil
  configurable).

## i18n FR / EN (addendum §11.6 — dès le jour 1)

- **next-intl v4**, **défaut français**, anglais complet. Toutes les chaînes
  UI passent par `messages/fr.json` + `messages/en.json` (typage statique :
  EN doit correspondre structurellement à FR, vérifié à la compilation).
- **Pas de routing par locale** (SPA single-route) : le serveur lit le cookie
  `tj_locale` au premier rendu (pas de flash, `<html lang>` correct), puis le
  `I18nProvider` côté client bascule **instantanément** (les deux catalogues
  sont embarqués) et persiste vers le cookie + `Profile.locale` (best-effort
  `PATCH /api/profile` ; l'inscription transmet la langue courante).
- **Synchronisation cross-device** : à la connexion, le cookie est aligné sur
  `Profile.locale`.
- **Commutateurs** : section « Langue » dans Réglages (persistée) + toggle
  compact FR/EN sur l'écran d'authentification.
- **Erreurs = codes** : Zod émet des codes (`emailRequired`…), les routes API
  renvoient des codes (`EMAIL_TAKEN`…) et le moteur de sizing des codes
  (`STOP_SIDE_LONG`…) — tous traduits côté client via
  `/src/lib/i18n-errors.ts`. Aucune prose utilisateur dans le moteur.
- **Labels métier** (`trading.*` dans les dictionnaires) remplacent l'ancien
  `LABELS` de `types.ts`.
- **Compromis documenté** : les **données de référence** seedées (noms des
  instruments « Or / Dollar US », tags d'erreurs) ne sont PAS traduites — ce
  sont des lignes de données éditables par l'utilisateur, pas des chaînes UI.
  Un utilisateur EN peut renommer ses instruments dans l'UI (phase 7).
- Formatage nombres/dates via `fr-CA` / `en-CA` (`intlLocale()`), synchronisé
  avec la langue active (`setFormatLocale`).

## Tests (addendum §11.8)

```bash
bun run test   # recrée db/test.db puis lance vitest (357 tests)
```

- **Base de test séparée** : `db/test.db` — recréée from scratch à chaque run
  (`scripts/test-db.ts` → `prisma db push` avec `DATABASE_URL` redéfini).
  La base de dev (`db/custom.db`) n'est **jamais** touchée.
- **Unitaires** (`tests/unit/`) : moteur de calcul (XAUUSD 68 pips/340 USD,
  EURUSD 24 pips, USDJPY avec conversion + flag estimation, shorts, coûts
  signés, breakeven 0.1R, sizing 100 $→0.2 lot exact, arrondi au pas
  inférieur, codes d'invalidité), agrégation d'exécutions (entrée moyenne
  pondérée, sorties partielles, clamp, commissions), détection de session UTC
  (frontières), scrypt + rate limiter.
- **Intégration** (`tests/integration/isolation.test.ts`) : **prouve que
  l'utilisateur A ne peut ni lire, ni modifier, ni supprimer** les comptes,
  stratégies, trades, exécutions, captures et vues sauvegardées de B (pattern
  de scoping `userId` systématique), et que les cookies de session ne
  résolvent que leur propre utilisateur. Étendu aux routes trades en phase 3.

## Schéma de données (20 modèles)

`User`, `AuthSession`, `Profile` (+`locale`), `Account` (+champs PROP :
`maxDailyLossPercent`, `maxTotalDrawdownPercent`, `profitTarget`,
`drawdownType` STATIC|TRAILING, `startDate`), `CashTransaction`, `Instrument`,
`Strategy`, `StrategyChecklistItem`, **`StrategyVersion`** (snapshots
immuables), **`SavedView`** (filtres nommés par page), `Trade`
(+`reviewStatus` NOT_REVIEWED|REVIEWED, +`isDraft` — l'autosave persiste un
vrai Trade brouillon), `TradeExecution`, `Tag`, `TradeTag`,
`TradeScreenshot`, `JournalEntry`, `TradingRule`, **`Goal`**, **`TradeRuleViolation`**.

Points clés :
- Chaque table possédée par un utilisateur a une colonne `userId` + index.
- `Instrument.userId = null` → preset global seedé (37 instruments : or,
  argent, 28 paires forex, 4 indices, 2 crypto, WTI). Les utilisateurs peuvent
  créer/surcharger leurs instruments.
- `Tag.userId = null` → presets globaux (12 tags d'erreurs, 4 contexte,
  5 setups). Les tags d'erreurs alimentent le calcul du « coût des erreurs ».
- SQLite n'a ni enums ni listes scalaires : les statuts sont des `String`
  validés par des unions TypeScript + Zod ; les listes (timeframes, sessions,
  checklist) sont du JSON en `String`.
- `Trade.externalId` unique par compte → déduplication des imports CSV.
- `CashTransaction` (dépôts/retraits signés) → la courbe d'équité ne compte
  jamais les flux de trésorerie comme performance.

## Moteur de calcul (`/src/lib/trading/`)

Fonctions pures, client-safe (aucun import Prisma), 100 % decimal.js :

| Fonction | Rôle |
|---|---|
| `priceDiff(direction, entry, exit)` | Différence signée selon la direction |
| `toPips` / `toPoints` / `pipsToPrice` / `pointsToPrice` | Conversions pip/point par instrument |
| `calcPnL({...})` | P&L brut (quote → compte), coûts, net, pips, points, flag estimation |
| `calcRMultiple` / `calcPlannedRR` | R (stop initial) et R:R planifié |
| `calcPositionSize({...})` | Risque (% ou montant) → lots arrondis au pas inférieur, risque réel, valeur du pip, notionnel |
| `calcPipValue` | Valeur du pip (quote + compte) |
| `classifyResult` | WIN / LOSS / BREAKEVEN (seuil 0.1R) |
| `previewTrade` | Agrégat live (pips, R, RR, risque %) pour les formulaires |
| `detectSession` | Session Asie/Londres/NY/overlap depuis l'heure UTC |
| `aggregateExecutions` | Coût moyen pondéré : entrées moyennes, sorties partielles, P&L réalisé |

Vérifié sur cas réels : XAUUSD (68 pips, 340 USD pour 0.5 lot), EURUSD (24
pips), USDJPY avec conversion, sizing (100 $ de risque → 0.2 lot exact),
exécutions partielles (entrée moyenne 1.08067, P&L 800 USD).

## Authentification multi-utilisateur (phase 2)

- **Sessions serveur révocables** : jeton opaque 256 bits en cookie
  `httpOnly` / `sameSite=lax` (30 jours), adossé à la table `AuthSession` —
  déconnexion = suppression côté serveur, pas seulement du cookie.
- **Mots de passe** : scrypt (node:crypto) avec sel par mot de passe et
  comparaison en temps constant. Un hachage factice égalise le temps de
  réponse quand le compte n'existe pas.
- **Validation Zod partagée** client/serveur (`/src/lib/auth/validators.ts`) —
  mêmes schémas des deux côtés, erreurs typées `{ error, message, fieldErrors }`.
- **Rate limiting** fixe en mémoire : 10 tentatives de connexion / 5 min par
  courriel, 5 inscriptions / 15 min.
- **Aucune erreur Prisma exposée** au client — enveloppe d'erreur générique
  en 500, codes typés (`EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `VALIDATION`…).
- **Profil auto-créé à l'inscription** (transaction `User` → `Account` « Compte
  principal » démo 10 000 USD → `Profile`), réparé idempotemment à la connexion.
- **Seed démo** : `demo@tradejournal.app` / `demo1234` (fuseau America/Toronto).
- Google OAuth : non disponible dans la sandbox (pas d'API Google) — le chemin
  Supabase Auth est documenté dans `prisma/rls.sql` et `.env.example`.

## Structure

```
messages/                # dictionnaires i18n (fr.json, en.json) — toutes les chaînes UI
prisma/
  schema.prisma        # 20 modèles, snake_case @map
  seed.ts              # instruments + tags globaux + compte démo (idempotent)
  rls.sql              # policies RLS Supabase/Postgres (chemin production)
scripts/
  test-db.ts           # recrée db/test.db (base de test isolée)
tests/
  unit/                # moteur, exécutions, sessions UTC, scrypt, rate-limit
  integration/         # isolation inter-utilisateurs A/B (addendum §11.8)
src/
  i18n/                # config, dictionnaires typés, provider (switch instantané)
  app/
    page.tsx           # SPA racine — session + locale résolues côté serveur (zéro flash)
    api/
      auth/            # signup · login · logout · me
      profile/         # PATCH profil (locale, thème, affichage)
      instruments/     # GET presets globaux
  components/
    app/               # shell : sidebar, nav, user-menu, palette ⌘K, session
    auth/              # écran connexion/inscription + accès démo 1-clic + toggle langue
    views/             # dashboard, placeholders par phase, outils, réglages (+ section Langue)
    tools/             # calculateurs (moteur /src/lib/trading)
    locale-toggle.tsx  # commutateur FR/EN compact
  lib/
    auth/              # types client-safe, scrypt, validateurs Zod (codes i18n)
    i18n-errors.ts     # traduction des codes d'erreur (API, validation, sizing)
    router.ts          # routeur hash (#/trades, #/outils…) + deep links
    api-client.ts      # fetch typé + erreurs ApiClientError
    format.ts          # formatage locale-aware (setFormatLocale)
    rate-limit.ts      # limiteur fixes en mémoire
    trading/           # moteur de calcul pur (aucune chaîne UI)
  server/
    session.ts         # sessions cookie + getSession()/requireUser()
    users.ts           # création utilisateur, réparation et mise à jour de profil
```

## Développement

```bash
bun run dev        # serveur dev sur :3000
bun run lint       # ESLint (0 erreur)
bun run test       # recrée db/test.db + vitest (357 tests)
bun run db:push    # applique le schéma Prisma
bun prisma/seed.ts # seed instruments + tags + compte démo (idempotent)
```

Compte démo : `demo@tradejournal.app` / `demo1234`.

> Après un `db:push` (régénération du client Prisma), redémarrer `bun run dev` :
> le serveur garde en mémoire le client chargé au démarrage.

## Phases

1. **Fondation** — schéma, moteur de calcul, seeds ✓
2. **Auth + shell** — sessions sécurisées, SPA, sidebar, palette ⌘K ✓
2.5. **Addendum §11** — i18n FR/EN, modèles StrategyVersion/SavedView/Goal/violations, champs PROP, tests + isolation inter-utilisateurs ✓
3. **Trades (v2 Phase 1)** — trade rapide ~20 s (modèles pré-remplissants, préférences mémorisées), formulaire complet live (aperçu pips/R/P&L, brouillons, conflits optimistes), table filtrable + vues sauvegardées, fiche détaillée (clôture, exécutions, captures WebP 1600 px), gestionnaire de modèles CRUD, dashboard temps réel (KPI 30 j/tous temps, courbe d'équité, positions ouvertes, stats par stratégie) ✓
4. **Analytics (v2 Phase 4)** — KPI avancés (SQN, Sharpe/Sortino, payoff, récupération), courbe d'équité + drawdown, distribution des R, breakdowns par 10 dimensions, insights automatiques « ce qui marche / ce qui coûte » ✓
5. **Stratégies, journal & calendrier (✓)** — checklists ENTRY/EXIT/RISK/CONTEXT (replace-all transactionnel + purge des références mortes des gabarits), versions snapshots immuables, stats par stratégie, journal quotidien (plan/revue/humeur/sommeil/discipline, upsert par jour local, deep-link `#/journal/{date}`), calendrier P&L mensuel (grille lundi-first, bucketing par jour local TZ profil, streaks, résumé), widget risque de breach PROP (limites quotidienne/totale STATIC ou TRAILING, objectif, seuils OK/WARNING ≥ 75 %/BREACHED)
6. **Objectifs, règles & violations (✓)** — export CSV de la liste filtrée, objectifs mesurables (6 métriques × 5 périodes, progression live fenêtre glissante TZ locale), règles de discipline (max trades/jour, perte max/jour, risque max/trade, CUSTOM documentaire), détection automatique des violations à chaque écriture de trade + ré-évaluation bulk après édition de règle, widgets dashboard progression + alertes, fiche trade « règles violées », enrichissement démo idempotent
7. **Réglages & déploiement (✓)** — vues #/comptes (CRUD complet + champs PROP), #/instruments (presets lecture seule + customs avec pip/digits/contrat), #/tags (groupées par type, presets readonly), éditeur de profil dans les réglages (nom, TZ, devise — session rafraîchie globalement), guide de déploiement Supabase + Vercel

## Phase 4 — Analytics (✓)

- **Moteur d'insights** (`/src/lib/analytics/insights.ts`, pur et client-safe,
  décimaux via decimal.js) :
  - **KPI avancés** : SQN (√N · R̄/σ sur les trades R), Sharpe et Sortino
    journaliers annualisés (√252, agrégation par jour local de sortie),
    facteur de récupération (P&L net / DD max), payoff (gain moyen /
    perte moyenne), durée moyenne, frais totaux, couverture R (% de trades
    avec un multiple R).
  - **Distribution des R** : 8 tranches (≤ −3R → ≥ 3R), bornes
    `[from, to)`, total R par tranche, comptage des trades sans R.
  - **Breakdowns** (10 dimensions) : stratégie, instrument, session,
    direction, jour de la semaine (TZ locale), heure d'entrée (tranches
    2 h, TZ locale), setup, raison de sortie, émotion avant entrée, plan
    suivi oui/non — triées par P&L net décroissant.
  - **Insights « ce qui marche / ce qui coûte »** : règles avec gardes
    d'échantillon minimum (≥ 3 trades par groupe) — extrêmes par
    dimension (meilleure/pire stratégie, instrument, session, jour,
    heure, setup), émotions extrêmes, écart de discipline (R moyen plan
    suivi vs écart, ± 0,3 R), **revenge trading** (re-entrées sous 24 h
    après une perte ≥ 2R), **overtrading** (jours à ≥ 5 trades vs jours
    calmes), « petites gains grosses pertes » (payoff < 0,8 avec WR > 50 %),
    poids des frais (≥ 10 % du gain brut), récupération, série de pertes
    (≥ 5), couverture R insuffisante (< 70 %). Chaque insight est un
    `{ rule, tone, params, weight }` — les paramètres bruts sont formatés
    par la vue (monnaie, %, R, libellés i18n), jamais de texte construit
    côté serveur.
- **API** `GET /api/analytics` (`/src/server/analytics.ts`) : filtres
  `period` (30 j / 90 j / année / tout, défaut 30 j) et `account`
  (optionnel, vérifié contre les comptes de l'utilisateur — fallback
  silencieux vers « tous »). Weekday/heure/date locale calculés côté
  serveur via `Intl.DateTimeFormat` dans le fuseau du profil (le moteur
  reste TZ-agnostic et déterministe). Courbe d'équité : même convention
  que le dashboard (comptes dans la devise du profil uniquement). Rate
  limit mémoire 60 req/min/user, Zod sur les query params (422),
  401 sans session.
- **Vue** `#/analytics` (`/src/components/analytics/analytics-view.tsx`) :
  barre de filtres (onglets de période + sélecteur de compte), grille de
  12 KPI, courbe d'équité + mini-graphe de drawdown, histogramme de la
  distribution des R (barres émeraude/rose), 3 colonnes d'insights
  (« Ce qui marche » / « Ce qui coûte » / « À noter », listes scrollables
  max-h-96), 10 cartes de breakdown avec barres proportionnelles au P&L
  net. États loading (skeletons), erreur (retry), vide (CTA vers tout
  l'historique ou saisie de trade). Étiquettes des enums réutilisant le
  dictionnaire `trading.*`, jours de semaine localisés via `Intl`.
- **Nav** : la section Analytics passe `ready: true` (plus de placeholder),
  entrée « Analytics » dans le groupe ANALYSE.
- **Jeu de démo enrichi** (`scripts/enrich-demo-analytics.ts`, idempotent
  par `externalId` « demoan- ») : 28 trades réalistes couvrant toutes les
  dimensions — 2 stratégies (Breakout Londres / Retracement NY), séquence
  revenge un vendredi (−2,5R puis 3 re-entrées), journée d'overtrading
  (6 trades), émotions contrastées (CALM → +1,8 R moyen vs FOMO → −0,8 R),
  discipline plan suivi, sessions/entrées réparties, frais réalistes.
- **i18n FR/EN** : section `analytics` complète (72 clés par langue) —
  KPI, graphes, insights ICU avec pluriels, breakdowns ; les clés
  `placeholder.analytics` sont retirées.
- **Tests** (314 au total, +20) : SQN/Sharpe/Sortino/payoff/récupération
  calculés à la main sur fixtures, bornes des tranches R (edges −3/0/1),
  groupements (plan oui/non, tranches horaires, tri par P&L), gardes
  d'insights (stratégie trop petite ignorée, discipline, fenêtre revenge
  24 h — aucun insight si re-entrée après 24 h, overtrading, seuils
  frais/couverture, série de pertes, émotions), entrée vide sans crash.
- **Vérifié au navigateur** : rendu FR complet (12 KPI formatés
  « +1 207,90 USD », courbe + drawdown + distribution R, insights en
  français naturel), bascule 30 j ↔ tout (23 ↔ 36 trades, insights et
  KPI recalculés), filtre par compte, locale EN (formats monétaires US,
  insights anglais), viewport mobile 390 px sans overflow horizontal,
  footer sticky sur page courte et poussé naturellement sur page longue,
  zéro erreur console, 401/422/fallback compte inconnu vérifiés au curl.

## Audit complet v2 (post-restauration) — correctif édition de trade

Audit navigateur complet de la roadmap v2 (Trades CRUD + Analytics) après
restauration de l'environnement : dashboard (KPI 30 j/tous temps, courbe
d'équité, positions ouvertes, stats par stratégie, widget PROP), table
trades (filtres direction/résultat/session/compte + vues sauvegardées
création/application/suppression), trade rapide (préférences mémorisées,
modèles + deep-link `?template=`), formulaire complet (aperçu live
pips/R:R/risque/P&L recalculés à la frappe), fiche détaillée (métriques
exactes, exécutions, commentaires), gestionnaire de modèles (CRUD +
« Utiliser »), clôture de position (dialogue prix/raison → recalcul),
analytics (12 KPI avancés, distribution R, drawdown, insights
« ce qui marche / ce qui coûte », breakdowns), i18n FR/EN — **390 tests
verts, lint 0 erreur, zéro erreur console**.

- **Bug découvert et corrigé** : l'édition d'un trade était **bloquée**
  (soumission → « Valeur invalide »). Cause : le `<select>` natif caché
  de Radix (rendu car le formulaire est un `<form>`) émet un événement
  « change » synthétique quand sa prop `value` change ; si l'`<option>`
  correspondante n'est pas encore montée, la valeur DOM retombe à `""`
  et `onValueChange("")` efface la valeur programmée. Le pré-remplissage
  de l'édition (statut `OPEN→CLOSED`, session `auto→OTHER`, etc.) était
  systématiquement écrasé → `status: ""` échoue la validation Zod.
  Les sélecteurs facteur (`AccountSelect`, `InstrumentSelect`,
  `TimeframeSelect`…) étaient déjà protégés par `guardEmpty()` dans
  `trade-bits.tsx`, mais **pas les 13 `<Select>` inline du formulaire**
  (statut, session, type d'ordre, condition, raison de sortie, émotions,
  notes de confiance/qualité/exécution, source P&L, statut de revue).
  Correctif : `guardEmpty` est exporté et appliqué aux 13 handlers du
  formulaire de trade + raison de sortie du trade rapide. Les autres
  vues (réglages, comptes, instruments, tags, stratégies) sont immunes :
  leurs sélecteurs ne sont pas dans un `<form>`.
- **Vérifié après correctif** : pré-remplissage statut « Clôturé » /
  session « Autre » intacts, PATCH 200, recalcul persisté (exit 1,0890 →
  P&L 80 USD), navigation retour fiche, 390/390 tests, lint 0.
- **Hygiène de précision** : `riskPercent`, `plannedRR` et `rMultiple`
  sont arrondis à 6 décimales dans `computeDerived` — l'affinité NUMERIC
  de SQLite tronque les décimales longues en float64 au stockage (ex.
  « 0.21983288304231124 »), ce qui affichait du bruit de précision dans
  le champ « Risque % » du formulaire d'édition.

# v3 — Broker auto-sync, partage & mentorat, portabilité & conformité

Extension en phases (comme v1/v2). Chaque phase est vérifiée (lint + tests +
navigateur) avant la suivante. Adaptations environnement (mêmes principes que
v1/v2, documentées dans le tableau en tête de README) :

| Exigence v3 | Implémentation sandbox |
|---|---|
| Supabase Postgres + RLS sur les nouvelles tables | SQLite : scoping `userId` systématique + **AccessContext** (voir ci-dessous) ; les policies SQL complètes (dont fonctions mentor `SECURITY DEFINER`) sont prêtes dans `prisma/rls.sql` pour le déploiement Postgres |
| Resend (emails invitations/mentors/suppression) | Notifications **in-app** via `NotificationLog` (les emails restent branchables : le service de notification est isolé derrière une interface) |
| `next/og` pour les images d'aperçu de liens | **Vérifié en sandbox** : `next/og` (ImageResponse) fonctionne en runtime Node — `src/app/s/[token]/opengraph-image.tsx` rend des cartes 1200×630 respectant la politique de rédaction (carte générique si lien mort, pour ne révéler aucune existence) |
| Vercel Cron (quotidien) | Endpoint `/api/cron/daily` protégé par token, appelable par curl/planificateur |
| Multi-pages `/settings/...`, `/s/[token]`, `/legal/...` | Réglages & pages internes : routes hash SPA (`#/reglages/broker-sync`…) ; **partage public : vraie route App Router `/s/[token]`** (rendu serveur sans auth, sans JS client, noindex) — vérifiée au navigateur dans la sandbox |

## Phase 1 — Fondations v3 (✓)

- **Schéma** (`prisma/schema.prisma`, 62 modèles) :
  - Sync broker : `BrokerConnection` (token hashé HMAC-SHA256 + pepper, liaison
    compte↔terminal verrouillée au 1er heartbeat), `SyncEventLog` (idempotence
    par `(userId, eventId)`, payload purgé à 14 j), `SymbolMapping`,
    `MagicNumberMapping`, `TradeModification` (historique SL/TP/volume),
    `AccountEquitySnapshot`, `ImportBatch`, `ReconciliationCandidate`,
    `TradeMergeLog` (snapshot d'undo 30 j)
  - Partage : `ShareLink` (SNAPSHOT/LIVE, expiration, max views, révocation),
    `MentorInvitation`, `MentorAccess` (scopes compte/stratégie + flags),
    `MentorAccessLog` (agrégé/jour), `TradeComment`, `CommentMention`,
    `CommentReadState`
  - Conformité : `ConsentRecord`, `AccountDeletionRequest`,
    `DeletedUserTombstone`, `DataExportLog`, `RateLimitBucket`
  - Extensions : `Trade.source/positionId/magicNumber/brokerComment/
    needsDetails/mfeMaeSource/mfeMaeComplete`, `CashTransaction.externalId`
    (unique par compte), `Account.brokerServer/brokerLogin`,
    `Profile.handle/publicDisplayName`
- **AccessContext** (`/src/lib/access/`) : chaque fonction d'accès données v3
  reçoit un contexte `{ viewerId, ownerId, role, scope, readOnly }`.
  `ownerContext()` (OWNER, écriture) vs `mentorContext()` (MENTOR, **lecture
  seule systématique**, scopes compte/stratégie). `assertWritable()` rejette
  toute mutation mentor **côté serveur**, pas seulement en masquant les
  boutons. Les ids venant du client sont vérifiés contre le contexte
  (`assertOwnId`, `canAccessAccount`…).
- **Tokens** (`/src/lib/tokens.ts`, server-only) : génération 256 bits
  URL-safe, hachage HMAC-SHA256 avec `TOKEN_PEPPER`, comparaison en temps
  constant, préfixe d'affichage (6 chars), IP pseudonymisées
  (`IP_HASH_PEPPER`), tombstone utilisateur hachée. Le token brut n'est
  jamais stocké ni journalisé.
- **Rate limiting DB** (`/src/lib/rate-limit.ts`) : buckets fenêtre fixe
  persistés (sans Redis), atomiques (updateMany incrémental → reset fenêtre
  expirée → create), clés toujours pré-hachées, pruning quotidien. Le
  limiter mémoire v1 reste pour les routes auth.
- **Moteur de rédaction** (`/src/lib/redaction/`) : `redactTrade`,
  `redactEquityCurve` (normalisation %/R), `redactStats`, presets
  « Pips & R only » et export anonymisé. Les champs masqués sont
  **structurellement absents** du payload (jamais juste cachés en CSS).
  Helpers de leak-test (`findLeaks`, `assertNoLeaks`, `tradeLeakProbes`)
  utilisés par les tests ET en runtime sur les endpoints publics.
- **Env** : `TOKEN_PEPPER`, `IP_HASH_PEPPER` (obligatoires, ≥ 16 chars),
  `NEXT_PUBLIC_APP_URL`, `LEGAL_*` (voir `.env.example`).
- **Tests** (119 au total) : tokens (génération/hash/temps constant),
  rédaction (leak tests sérialisés : aucun montant/nom de compte/broker/IP
  n'apparaît nulle part), AccessContext (lecture seule mentor, scopes,
  filtres Prisma), rate limiter DB (limites, reset de fenêtre, pruning),
  **isolation v3 étendue** (A ne peut rien lire/écrire/supprimer chez B sur
  toutes les nouvelles tables ; suppression en cascade complète ; unicité
  `(userId, eventId)`).

## Phase 2 — Sync broker (✓)

- **Endpoints** (`/api/ingest/mt`, `/api/ingest/mt/ping`) : Bearer token
  (recherche par hash HMAC-SHA256), skew max 10 min (anti-replay), limite
  ~1 Mo / 200 événements par requête, rate limits par token (60/min) et par
  IP hachée (240/min), gate de version de schéma (rejet net des versions
  majeures inconnues), réponses par événement (ACCEPTED / DUPLICATE /
  REJECTED + raison). Le `ping` renvoie la config distante
  (`historyBackfillFrom`, cadence heartbeat) — l'utilisateur pilote depuis
  le web sans recompiler l'EA.
- **Moteur d'événements** (`/src/lib/sync/`) : idempotence atomique par
  `(userId, eventId)` (contrainte unique = verrou ; les lignes FAILED d'un
  crash sont rejouables), traitement chronologique intra-lot, upserts
  « fill-missing-only » qui ne font JAMAIS régresser un trade CLOSED → OPEN.
  MT5 : position = trade, deals in/out/in-out/out-by → exécutions
  ENTRY/ADD/PARTIAL_EXIT/FINAL_EXIT, reversals netting = close+open.
  MT4 : chaînage des tickets « from #N » en un seul trade (stitch EA +
  stitch serveur en défense). P&L broker (devise du compte) prioritaire
  (`pnlSource = BROKER`), pips/points/R depuis le stop INITIAL,
  TradeModification (historique SL/TP/volume), MFE/MAE trackés par l'EA
  (`mfeMaeComplete = false` si suivi partiel), BALANCE_OPERATION →
  CashTransaction dédupliquée par `externalId`, HEARTBEAT →
  AccountEquitySnapshot (1 snap / 15 min), binding (server, login) au
  premier payload puis MISMATCH en cas de changement (notification in-app,
  reset par le propriétaire).
- **Normalisation partagée** (`/src/lib/sync/normalize.ts`, pur) : conversion
  UTC par offset serveur, coûts MT (négatifs) → convention app (positifs),
  symboles broker (suffixes .pro/.raw/m…, alias GOLD→XAUUSD) réutilisée par
  l'import de fichiers (phase 3), inférence de spec (pip = 10 points,
  métaux 0.10), exit reason SL/TP avec tolérance.
- **Mappings** : SymbolMapping (auto-résolu → badge « à vérifier » +
  confirmation du pip dans l'UI), MagicNumberMapping (magic → stratégie,
  scopable par connexion).
- **Statuts** : PENDING / ACTIVE / STALE (30 min en semaine, 72 h le
  week-end FX — jamais d'alerte le week-end) / MISMATCH / REVOKED ; sweep
  à l'ouverture de l'app (`/api/broker-sync/overview`) + notification
  SYNC_STALE in-app (service de notification minimal v3).
- **EAs** : `ea/MT5/TradeJournalSync.mq5` (OnTradeTransaction + OnTimer +
  outbox persistant FILE_COMMON + backoff exponentiel + MFE/MAE + backfill
  HISTORY_BATCH paginé + ping de config) et `ea/MT4/TradeJournalSync.mq4`
  (scan/diff du pool d'ordres + stitching « from #N »). ⚠️ **NON VÉRIFIÉS** :
  le MQL ne se compile pas dans cet environnement — à compiler dans
  MetaEditor et tester sur COMPTE DÉMO d'abord (en-tête dans chaque
  fichier). Copies téléchargeables : `/public/ea/`.
- **Simulateur** : `bun scripts/simulate-ea.ts [email]` poste un scénario
  complet (heartbeat, open, modify, partial, close, dépôt, doublon,
  out-of-order, mauvais login) contre le serveur dev et affiche les
  résultats par événement + l'état final.
- **UI** : `#/reglages/broker-sync` (wizard création → token affiché UNE
  fois avec boutons copier endpoint/token + étapes d'installation FR/EN,
  cartes de connexion avec badges de statut, rotation/révocation/reset de
  liaison, exigences honnêtes affichées), mappings symboles + magic,
  widget dashboard (statut par connexion, equity heartbeat, « N trades
  synchronisés à compléter »), entrée de nav + i18n FR/EN.
- **Tests** (155) : moteur d'ingest (idempotence, out-of-order, partial
  close, stitching MT4, modifications SL/TP, balance, backfill, binding +
  MISMATCH, STALE sweep) + normalisation pure (UTC, coûts, symboles,
  specs, exit reasons, statuts/semaine). Vérifié au navigateur : création
  (y compris erreur 409 doublon), token-once, révocation immédiate,
  dashboard temps réel.


## Phase 3 — Import de fichiers & réconciliation (✓)

- **Détection de format par contenu** (`/src/lib/import/detect.ts`) : MT4
  relevé détaillé (HTML), MT5 rapport (HTML), MT5 historique (CSV/XLSX),
  cTrader (CSV/XLSX), TradingView (CSV), CSV générique en repli — les
  signatures sont testées contre des fixtures.
- **Parseurs navigateur** (`/src/lib/import/`, purs et testés) : tolérants
  aux exports localisés — en-têtes FR/EN (fuzzy matching), virgules
  décimales, séparateurs de milliers (espaces insécables), BOM, formats de
  dates multiples, lignes de résumé ignorées, colonnes Prix dupliquées
  résolues par indexation, table Deposit/Withdrawal MT4, combinaison
  colonnes Date + Heure, devis MT5/cTrader groupées par position.
  Conversion UTC **côté serveur** avec le fuseau déclaré (DST géré via
  Intl). Le fichier brut ne quitte JAMAIS le navigateur : parsing en Web
  Worker (avec repli main-thread si le bundler ne transforme pas l'URL) et
  envoi par chunks de 200 lignes.
- **Serveur d'import chunké** (`/src/server/import.ts`) : ImportBatch avec
  hash SHA-256 du fichier (avertissement de re-upload), dédoublonnage par
  `(accountId, externalId)`, ré-import qui MET À JOUR les champs broker
  (prix, heures, volumes, coûts, exécutions) sans jamais toucher les
  champs utilisateur, trades manuels jamais écrasés (réservés à la
  réconciliation), rapport d'erreurs téléchargeable en CSV, stats
  recalculées avec le moteur v1 (specs par preset : XAUUSD garde son pip
  0.10 même sans spec EA).
- **Matcher de réconciliation** (`/src/lib/reconciliation/matcher.ts`,
  pur) : instrument + direction requis, score 0-1 pondéré (proximité
  d'entrée ≤ 2 min / ≤ 15 min / même jour, prix d'entrée en pips selon
  l'instrument, volumes, proximité de sortie — seulement si l'entrée est
  plausible), ticket identique = certain, seuils configurables, filtre
  haute confiance (≥ 0.9 ET candidate unique) pour le merge automatique.
- **Merge transactionnel + undo 30 j** (`/src/server/reconciliation.ts`) :
  le trade broker survit avec ses prix/P&L ; le journal manuel GAGNE
  (notes, analyse, émotions, ratings, checklist, stratégie, SL/TP
  planifiés, statut de revue) ; TOUTES les lignes enfants re-pointées
  (captures, tags, revue, liens événements, contexte marché, liens de
  partage, modifications) ; snapshot complet du trade absorbé dans
  TradeMergeLog ; l'undo restaure le trade, ses exécutions, re-pointe les
  enfants et rouvre la candidate. Exécution dans une transaction
  Prisma avec timeout étendu et client transactionnel propagé au moteur
  de calcul.
- **UI** : `#/importer` (drag & drop, aperçu tableau, choix compte + fuseau,
  progression par chunk, résultat + rapport d'erreurs, redirection vers la
  réconciliation) et `#/reconciliation` (diff côte à côte, score + raisons
  traduites, fusion / pas un doublon / garder séparé, fusion groupée haute
  confiance, liste des fusions annulables), nav + i18n FR/EN.
- **Tests** (194 au total) : 22 tests parseurs contre fixtures (EN/FR,
  virgules décimales, NBSP, BOM, colonnes dupliquées, échecs codés),
  8 tests matcher (exigences dures, scores, tolérance pips, haute
  confiance), 9 tests d'intégration import→match→merge→undo (y compris
  ré-import qui met à jour sans dupliquer, trades manuels protégés,
  journal préservé, undo intégral). Vérifié au navigateur : import MT4
  réel (fichier fixture), fusion avec journal préservé
  (prix broker + notes utilisateur + statut REVIEWED), undo.

⚠️ **Parseurs non vérifiés contre des exports réels** : les fixtures sont
synthétiques (documenté dans l'UI). Les parseurs échouent proprement avec
un message actionnable — aucun import silencieux de données erronées.
## Phase 4 — Partage public (✓)

- **Service de liens de partage** (`/src/server/sharing.ts`) : TRADE (fiche
  d'un trade) ou REPORT (rapport de période calculé à la volée par le moteur
  d'analytique v1, optionnellement filtré par compte). Jetons 256 bits
  URL-safe générés une fois, stockés en HMAC-SHA256 (`TOKEN_PEPPER`) — le
  hash n'est JAMAIS le jeton, et l'URL brute n'est affichée qu'à la création.
  Modes **SNAPSHOT** (copie rédactée figée dans `snapshotJson`) et **LIVE**
  (reconstruction + re-rédaction à chaque lecture ; meurt si le trade est
  supprimé). Expiration obligatoire (7 j → 10 ans), limite de vues
  optionnelle, comptage atomique anti-course (`updateMany` gardé).
- **Réduction serveur stricte** : le moteur v1 (`/src/lib/redaction`) tourne
  avant stockage ET à chaque lecture LIVE. Les champs masqués sont
  **structurellement absents** du payload. Double garde-fou runtime :
  1. scan par CLÉS (`assertNoHiddenKeys` — zéro faux positif : une clé
     interdite ne peut pas survivre), 2. sondes chaînes distinctives
     (compte/courtier/notes). Les scans par valeur numérique restent des
     outils de TEST (un R visible de 0,5 peut légitimement égaler des lots
     cachés de 0,5 — régression documentée + testée).
  - **Rapports** : montants/stats monétaires supprimés (`netPnl`, `grossWin`,
    `maxDrawdown`, `initialBalance`…), courbe convertie en **% de
    performance**, tables par stratégie/instrument sans colonne P&L.
- **Page publique `/s/[token]`** (vraie route App Router, RSC) : sans login,
  sans JS client (fonctionne JS désactivé), `noindex`, locale `?lang=`
  → cookie → FR. Vue trade (badges, KPIs pips/R, niveaux, journal,
  psychologie, exécutions, captures) et vue rapport (KPIs, courbe SVG,
  tables). Invalide/expiré/révoqué/limite → **même page générique** (aucun
  signal d'existence pour un sondeur). Rate-limit par hash de jeton
  (240/h) et par IP hachée (120/h) — jamais d'IP brute stockée.
- **Proxy média public** (`/api/public/media/[token]/[screenshotId]`) : les
  captures passent par le jeton — chaque `<img>` re-valide le lien, donc
  **révoquer le lien tue instantanément les captures partagées** (vérifié).
  La politique `hideScreenshots` et le mode SNAPSHOT (captures figées à la
  création seulement) sont respectés. Rate-limit IP 120/h + jeton 300/h.
- **Image OG** (`opengraph-image.tsx`, 1200×630 via `next/og`) : carte de
  trade (symbole, direction, pips, R — P&L seulement si autorisé) ou de
  rapport (trades, win rate, R total). Lien mort → carte de marque
  générique identique pour révoqué/invalide. Ne compte pas de vue.
- **UI** : dialogue de partage depuis la fiche trade (titre, mode, presets
  Tout / Pips & R / personnalisé à 7 interrupteurs, expiration, limite de
  vues, URL affichée une fois avec copier/ouvrir) ; création de rapport
  partagé depuis `#/reglages/partage` (période 30 j/90 j/12 mois/année/
  personnalisée + compte optionnel) ; vue de gestion (statut réel par lien,
  vues/max, dernière vue, révocation avec confirmation, carte « modèle de
  sécurité ») ; nav + i18n FR/EN.
- **Export PNG carte** (`/src/lib/export-image/card.ts`, canvas client) :
  1200×675 prête à publier. **Mode anonyme** : pips & R seulement, dates
  sans heures, aucun montant/compte/courtier — vérifié visuellement (aucune
  fuite). Téléchargement `trade-SYMBOLE-date[-anonyme].png`.
- **Tests** (233 au total) : 17 unitaires statut/snapshots (transitions
  ACTIVE/EXPIRED/REVOKED/VIEW_LIMIT, rédaction rapport — absence
  structurelle + courbe % + scan de fuites, round-trip JSON sans jeton
  brut), 16 d'intégration (création→résolution→comptage de vues→limite
  maxViews→expiration→révocation immédiate (page + captures)→SNAPSHOT figé
  vs LIVE à jour→LIVE meurt avec le trade→IDOR refusé (trade et compte
  d'autrui)→isolation liste/révocation→proxy média par politique), + 6
  nouveaux tests redaction (clés cachées, sondes numériques strictes).
  Vérifié au navigateur : création pips & R, page publique sans fuite
  (contrôle visuel VLM), rapport % , révocation→GONE, OG (valide/révoqué/
  invalide), export anonyme, mobile 390 px.

## Phase 5 — Mode mentor, commentaires & mentions (✓)

- **Pattern AccessContext (v3 §1, appliqué partout)** : `requireMentorContext()`
  construit un contexte MENTOR contraint et **toujours lecture seule** —
  chaque requête re-vérifie la ligne d'accès (ACTIVE + non expirée) :
  pause, expiration et révocation sont effectives à la requête suivante,
  rien n'est mis en cache. Les mentors n'écrivent JAMAIS dans le journal
  consulté ; la seule écriture est `TradeComment` sous leur propre id.
- **Handle public** (`Profile.handle`, unique, `[a-z0-9_]{3-24}`) :
  prérequis au mentorat et aux mentions. Suggestion automatique depuis
  l'email, réservation atomique (collision → `HANDLE_TAKEN`),
  `publicDisplayName` optionnel pour l'affichage. Exposé dans la session.
- **Invitations** (`/src/server/mentors.ts`) : jeton 256 bits `mtr_…`
  affiché UNE fois, stocké en HMAC-SHA256 (`TOKEN_PEPPER`). Gate stricte :
  compte connecté dont l'email ÉGALE l'email invité, invitation PENDING et
  non expirée (7 j) — un mauvais compte reçoit un 404 neutre (aucun signal
  d'existence). Le centre in-app liste les invitations reçues et agit par
  id (les jetons bruts ne sont jamais ré-exposés) avec la même gate email.
  Rate limit 10 invitations/jour/propriétaire, 10 max en attente.
  Ré-invitation d'un mentor révoqué = réactivation avec le nouveau scope.
- **Permissions fines** : périmètre comptes (ALL/LIST), périmètre
  stratégies (ALL/LIST, les trades sans stratégie restent visibles),
  voir les montants (sinon pips & R), voir le journal (notes +
  psychologie), voir les captures, voir les analytiques, commenter,
  expiration optionnelle. Éditables à chaud, effet immédiat.
- **Vues mentor read-only** (`/src/server/mentor-views.ts`) : listes et
  fiches filtrées par `mentorTradeWhere` (comptes + stratégies du scope),
  **rédaction structurelle** via le même moteur que le partage public —
  `!canViewAmounts` → `hideAmounts` + `hideAccountInfo` (les soldes SONT
  des montants), `!canViewJournal` → `hideNotes` + `hidePsychology`,
  `!canViewScreenshots` → captures absentes. Les heures exactes restent
  visibles (un mentor n'est pas le web public). Les captures passent par
  `/api/mentor/{ownerId}/media/{id}` qui re-valide l'accès, la permission
  ET le scope du trade à CHAQUE requête — révoquer tue les images.
- **Commentaires & mentions** (`/src/server/comments.ts`) : fil sur la
  fiche trade (vue propriétaire ET mentor), markdown restreint rendu par
  react-markdown SANS rehype-raw (HTML brut échappé par construction),
  liens `rel="nofollow noopener noreferrer"`, 4000 caractères max. Un seul
  niveau de réponse. Suppression : auteur ou propriétaire ; tombstone si
  réponses. Mentions `@handle` limitées aux personnes ayant ACTUELLEMENT
  accès au trade (propriétaire + mentors scopés) — validation serveur,
  mention invalide = rejet avec message actionnable ; la regex ignore les
  emails. Rate limit 20 commentaires/10 min/auteur.
- **Notifications** : cloche in-app (en-tête, polling 60 s, non-lus,
  marquer tout lu) sur `NotificationLog` ; types ajoutés COMMENT_NEW /
  COMMENT_REPLY / MENTION / MENTOR_INVITE_RECEIVED / MENTOR_INVITE_ACCEPTED /
  MENTOR_ACCESS_REVOKED. Debounce 10 min par trade, jamais à l'auteur,
  liens profonds selon le rôle (`#/trades/{id}` vs `#/mentor/{ownerId}/…`).
- **Read-states & badges** : `CommentReadState` par utilisateur/trade —
  ouvrir le fil le marque lu ; badge non-lus côté propriétaire
  (`/api/comments/unread`, borné aux 500 trades / 1000 commentaires
  récents) et par mentee (200 trades) ; surlignage des commentaires plus
  récents que la dernière lecture.
- **UI** : `#/reglages/mentors` (handle + nom public, invitation avec
  éditeur de permissions et comptes/stratégies, lien affiché une fois,
  mentors actifs avec pause/reprendre/révoquer + édition, invitations en
  attente, journal d'accès agrégé par jour — transparence RGPD),
  `#/mentor` (cartes mentees avec badges nouveaux trades / à revoir /
  commentaires non lus + invitations reçues), `#/mentor/{ownerId}`
  (bannière persistante « lecture seule », onglets Trades / Journal /
  Analytique, courbe en % quand les montants sont masqués),
  `#/mentor/{ownerId}/trades/{id}` (fiche redactée + fil de commentaires),
  `#/invitation/{token}` (aperçu expéditeur + permissions, accepter /
  refuser, guidage handle manquant). Nav « Espace mentor » conditionnelle
  (visible seulement si l'utilisateur est mentor), i18n FR/EN complet.
- **Tests** (277 au total) : 15 unitaires (parsing des mentions y compris
  inertie des emails, mapping scope→politique de rédaction, schémas Zod
  handle/permissions) + 29 d'intégration : invitation (token unique,
  mauvais compte→404 neutre, auto-invitation refusée, doublon en attente,
  acceptation→accès ACTIVE + notification, re-acceptation→NOT_PENDING),
  lectures scopées (compte hors périmètre absent de la liste ET de la
  fiche, absence STRUCTURELLE de netPnl/lots/accountName/emotions,
  analytique calculée sur les seuls trades du scope avec KPIs réduités,
  journal null quand interdit), journal d'accès + lastViewedAt, résumé
  mentee (nouveaux trades du scope seulement), commentaires (refus sans
  accès, canComment, mention valide→MENTION + ligne, mention invalide
  rejetée, candidats limités aux détenteurs d'accès, réponse→lien profond
  mentor, un seul niveau, édition par l'auteur seule, tombstone avec
  réponses, suppression par le propriétaire, badge non-lus→0 après
  lecture), pause→refus immédiat→reprise, édition de scope reflétée à la
  lecture suivante, révocation→refus + notification.
- **Correctifs transverses (découverts par la vérification navigateur)** :
  `useHashRoute` fait un premier rendu neutre puis applique le hash après
  montage — plus aucune erreur d'hydratation au chargement direct d'une URL
  `#/…` (défaut préexistant touchant toutes les vues) ; le SessionProvider
  vide le cache React Query à chaque changement d'identité (login/logout/
  bascule de compte) — les caches user-scoped ne fuient plus entre comptes ;
  le FAB « + » mobile remonte au-dessus du footer sticky (plus de
  chevauchement du texte).

## Phase 6 — Portabilité & conformité RGPD (✓)

- **Export complet (art. 20)** (`/src/server/account-export.ts`) : archive ZIP
  de TOUT ce que l'app stocke sur un utilisateur — 28 fichiers JSON par
  domaine (profil, comptes, trades avec exécutions/captures/revues/
  violations/modifications/contexte, stratégies + versions, journal, règles,
  objectifs, vues, modèles, caisse, rapports, scénarios, calendrier éco,
  prop firms, sync broker, partages, mentorat dans les deux sens,
  commentaires + mentions, notifications, consentements, historique des
  exports) + les fichiers de captures originaux (`screenshots/`), un
  `manifest.json` (compteurs, exclusions documentées — transparence art. 12)
  et un README bilingue. **Secrets exclus PAR REQUÊTE** (select lists, pas
  un filtrage a posteriori) : jamais de `passwordHash`, `tokenHash`
  (broker/partages/invitations) ni d'ids de session vivants. Décimaux
  sérialisés en chaînes exactes, dates en ISO. Cooldown 24 h (bucket DB
  clé HMAC), `DataExportLog` (FULL, taille, version de schéma).
  `GET /api/account/export` renvoie le ZIP, `/history` l'historique.
- **Suppression de compte (art. 17)** (`/src/server/account-deletion.ts`) :
  planification après **ré-authentification par mot de passe** (scrypt
  verify — une session détournée ne peut pas programmer l'irréversible),
  délai de grâce de **7 jours** annulable à tout moment, notifications
  in-app DELETION_SCHEDULED/CANCELLED, bannière app-wide persistante
  (rafraîchie toutes les 5 min) avec compte à rebours et bouton d'annulation.
  Exécution par le cron : transaction tombstone (HMAC-SHA256 du user id avec
  TOKEN_PEPPER — preuve d'effacement intentionnel, rien de réversible) +
  `user.delete` en cascade (74 relations `onDelete: Cascade` couvrent toutes
  les tables, y compris les commentaires du user sur les journaux d'autrui),
  puis suppression récursive du dossier `uploads/{userId}`. Idempotent par
  construction : la ligne PENDING disparaît avec l'utilisateur, un re-run ne
  peut pas supprimer deux fois ; l'échec d'un user ne bloque pas les autres.
- **Cron quotidien** (`/api/cron/daily`, protégé par `CRON_SECRET` bearer —
  sans secret configuré : 503 refus explicite, jamais un endpoint ouvert) :
  exécution des suppressions dues, pruning des buckets rate-limit (> 24 h),
  purge des payloads sync (> 14 j — la ligne d'audit reste, la charge utile
  personnelle part), suppression des snapshots d'annulation de fusion
  expirés (30 j), expiration des invitations mentor en retard, suppression
  des liens de partage expirés depuis + 7 j (grâce pour onglets ouverts),
  pruning des notifications > 90 j. Rapport détaillé renvoyé, chaque étape
  idempotente.
- **Consentements (art. 7)** : TERMS + PRIVACY enregistrés **dans la
  transaction de création du compte** (atomique : aucun utilisateur ne peut
  exister sans preuve de consentement), versions datées
  (`2025-11-01` — un bump de version permet une bannière de re-consentement
  future), historique lisible dans les réglages (type, version, accordé/
  refusé, date). Les comptes préexistants ne sont pas rétro-convertis
  (documenté).
- **Pages légales publiques** (`#/legal/mentions`, `#/legal/confidentialite`,
  `#/legal/cookies`) : rendues **même déconnecté** (AppRoot route vers la vue
  standalone au lieu de l'écran d'auth — pas de mur de connexion pour
  l'information légale, art. 12), identité éditable via `LEGAL_*`
  (`/api/legal` public, fallbacks neutres — la page rend toujours), contenu
  structuré i18n FR/EN : responsable, données collectées (dont la politique
  IP : jamais d'IP en clair, HMAC + pepper), bases légales, durées de
  conservation alignées sur le cron, droits + modalités d'exercice in-app,
  destinataires, autorité de contrôle. Politique cookies : cookies
  strictement nécessaires uniquement (session httpOnly + préférences), aucun
  tracking. Liens dans les footers de l'app ET de l'écran d'auth.
- **UI** `#/reglages/compte` : carte Export (bouton, note de cooldown,
  historique tailles + versions), zone danger Suppression (dialogue mot de
  passe + mot de confirmation « SUPPRIMER », état PENDING avec compte à
  rebours et annulation), carte Consentements. Entrée de nav « Compte &
  données » (ShieldCheck) + lien depuis Réglages. i18n FR/EN complet.
- **Tests** (294 au total, +17) : consents à l'inscription (TERMS+PRIVACY
  atomiques, listing), export (28 entrées ZIP présentes, manifeste cohérent,
  décimaux exacts, **isolation** — le trade de B n'apparaît jamais dans
  l'archive de A, captures byte-identiques, commentaire de B sur le trade de
  A exporté sous onMyTrades, **aucune fuite** — valeurs de hash et clés
  secrètes absentes de chaque entrée, sessions en métadonnées seules,
  DataExportLog + cooldown 429 avec retryAfterMs), suppression (mauvais mot
  de passe 403, grâce +7 j respectée par le cron, double-planification
  refusée, annulation + notification, exécution → cascade totale vérifiée
  table par table + tombstone HMAC 64 chars + uploads supprimés + autres
  utilisateurs intacts, idempotence), maintenance (payloads purgés, merge
  logs supprimés, invitations expirées). Le test d'isolation v3
  « consentements » est mis à jour : B possède désormais ses 2 consentements
  d'inscription, jamais ceux de A.
- **Vérifié au navigateur** : pages légales déconnecté (layout standalone
  avec footer sticky), connexion démo, vue compte (3 cartes), export réel
  (ZIP 15 Ko téléchargé, historique, toast de cooldown 429 au 2e essai),
  cycle suppression complet (403 mauvais mot de passe → planification
  +7 j → bannière → annulation), cron (401 sans/avec mauvais token, 200 avec
  le bon), pages légales connecté, locale EN, viewport mobile, footer sticky
  sur page courte et poussé naturellement en cas de débordement, zéro
  erreur console sur les flux réels.

## Phase v1-6 — Objectifs, règles & détection de violations (✓)

- **Moteur de règles** (`/src/lib/trading/rules.ts`, pur et client-safe) :
  - `MAX_TRADES_PER_DAY` : violation dès que le nombre de trades non
    brouillon OUVERTS dans la journée locale (TZ profil, attribution par
    heure d'entrée, trade inclus) DÉPASSE la limite (count > value).
  - `MAX_DAILY_LOSS` : violation dès que le P&L net du jour local de
    SORTIE (même convention que le calendrier P&L) ATTEINT −limite
    (≤ −value) — évalué uniquement sur les trades clôturés.
  - `MAX_RISK_PER_TRADE` : violation dès que le risque à l'entrée
    (riskAmount) dépasse la limite — évalué aussi sur les trades ouverts.
  - `CUSTOM` : règle documentaire, jamais détectée automatiquement.
  - Garde anti-configuration : valeur ≤ 0 → règle ignorée ; brouillons
    jamais évalués ; ordre des violations = ordre des règles.
- **Moteur d'objectifs** (`/src/lib/trading/goals.ts`, pur et client-safe) :
  - 6 métriques : NET_PNL, WIN_RATE, AVG_R, PROFIT_FACTOR ("Infinity"
    sans perte, null sans données), TRADE_COUNT (0 sans trade), DISCIPLINE
    (moyenne des scores 1-5 du journal).
  - 5 périodes glissantes ancrées sur l'instance COURANTE (semaine
    lundi-first, mois, trimestre, année, ALL_TIME) dans la TZ profil —
    un objectif MONTHLY évalué le 14 compte les trades clôturés depuis le
    1er (ou la date de début si postérieure) ; clamp par startDate /
    endDate du goal.
  - `progressPercent` 0-100 plafonné, `isAchieved` (courant ≥ cible,
    cible > 0), `isExpired` (échéance passée non atteinte) — ACHIEVED /
    MISSED sont calculés au lecteur, jamais stockés.
- **Détection automatique** (`/src/server/rules.ts`) :
  - Chaque create/update/close de trade ré-évalue SES violations
    (delete-then-insert idempotent, best-effort — un échec de détection
    ne fait jamais échouer l'écriture du trade).
  - Édition de règle (kind/value/isActive) → ré-évaluation BULK de tout
    l'historique : agrégats par jour local en JS (SQLite sans TZ), une
    transaction réécrit toutes les lignes `TradeRuleViolation`.
  - `note` = JSON machine-readable `{ kind, measured, limit }` — l'i18n
    se fait à l'affichage.
- **API** : `GET/POST /api/goals`, `PATCH/DELETE /api/goals/[id]`,
  `GET/POST /api/rules`, `PATCH/DELETE /api/rules/[id]` (ré-évaluation
  en cascade), `GET /api/rules/violations?days=30` (plafonné à 100),
  `GET /api/trades/[id]/violations`, `GET /api/trades/export` (CSV de la
  liste FILTRÉE — même traduction filtres → where que la liste ;
  `?lang=fr|en` pour les en-têtes localisés, BOM UTF-8 + CRLF pour
  Excel, plafond 10 000 lignes + en-tête `X-Trades-Truncated`).
- **CSV** (`/src/lib/trading/csv-export.ts`, pur) : 27 colonnes MT4-style,
  échappement RFC 4180, décimaux exacts (strings du DTO), oui/non FR-EN.
- **Vues** : `#/regles` (3 onglets — objectifs avec barres de progression
  + fenêtre + pause/reprise, règles avec limite formatée selon le type +
  activation, violations avec mesuré/limite + deep-link vers le trade),
  widgets dashboard (progression des objectifs actifs, alertes violations
  30 j — cachés si vides), section « règles violées » sur la fiche trade
  (cachée si clean), bouton « Export CSV » dans la liste des trades.
- **i18n FR/EN complet** (`goalsView`, `dashboard.goalsCard`,
  `dashboard.violationsCard`, `trades.list.exportCsv`,
  `trades.detail.violations`).
- **Démo** (`scripts/seed-demo-phase6.ts`, idempotent) : 4 objectifs
  (P&L 2 k/mois, win rate 50 %, R moyen 0.3, discipline 4/5), 4 règles
  (3 trades/jour, −1 500 $ stop journalier, 600 $/trade, no-revenge
  CUSTOM), ré-évaluation bulk → 26 violations sur l'historique démo.
- **Tests** : 33 unitaires (moteurs règles/goals — fenêtres TZ Toronto
  incl. changement de jour, métriques, expiration, gardes) — 390 au total.

## Phase v1-7 — Réglages & déploiement (✓)

- **Comptes (`#/comptes`)** — CRUD complet : type (LIVE/DEMO/PROP/BACKTEST),
  devise, solde initial, levier, activation ; section PROP dédiée (perte
  max/jour %, drawdown max % STATIC|TRAILING, objectif, date de début) qui
  alimente le widget de breach du dashboard. Suppression bloquée pour les
  comptes avec historique (409 → désactiver à la place).
- **Instruments (`#/instruments`)** — les 20 presets globaux en lecture
  seule (note de convention XAUUSD 0.10 vs 0.01) + instruments
  personnalisés : symbole, classe d'actif, paire de devises, digits, taille
  de pip (garde 0 < pip < 1), point, contrat, activation. Suppression
  bloquée tant que des trades référencent l'instrument (409 — l'historique
  ne perd jamais silencieusement son instrument).
- **Tags (`#/tags`)** — tags personnels groupés par type
  (SETUP/MISTAKE/CONTEXT/CUSTOM) avec couleur, édition et suppression
  (associations en cascade) ; presets globaux listés readonly.
- **Éditeur de profil (réglages)** — nom affiché, fuseau horaire (liste
  IANA courante, la valeur actuelle toujours proposée), devise de base ;
  `PATCH /api/profile` puis rafraîchissement de la session globale (les
  jours locaux calendrier/journal/règles suivent immédiatement).
- **APIs** : `PATCH/DELETE /api/tags/[id]`, `GET /api/instruments`
  (presets + customs du caller, auth optionnelle), `POST /api/instruments`,
  `PATCH/DELETE /api/instruments/[id]` ; `isPreset` exposé sur les DTOs
  tags et instruments ; erreurs typées `INSTRUMENT_DUPLICATE`,
  `INSTRUMENT_PIP_INVALID`, `INSTRUMENT_HAS_TRADES`.
- **i18n FR/EN complet** (`accountsView`, `instrumentsView`, `tagsView`,
  clés éditeur profil).
- Tous les placeholders de navigation sont retirés — chaque entrée de la
  sidebar est une vue fonctionnelle.

## Déploiement (Supabase + Vercel)

> Check-list pour passer du sandbox SQLite à une instance publique.

1. **Supabase (PostgreSQL)** — créer un projet, récupérer
   `DATABASE_URL` (mode session pooler). Le schéma Prisma est
   SQLite-first : adapter `provider("sqlite")` → `provider("postgresql")`
   puis `bun run db:migrate` (les `Decimal` deviennent `decimal(65,30)`,
   les listes JSON restent des `String`). ⚠️ **Pause du projet Supabase
   après ~7 jours d'inactivité** (plan gratuit) : prévoir un ping
   hebdomadaire (cron `GET /api/legal` ou uptime monitor) ou accepter le
   cold-start ~30 s.
2. **Vercel (framework Next.js)** — importer le repo, ajouter
   `DATABASE_URL` + les variables de session (voir `.env.example`), déployer.
   ⚠️ **Le plan Hobby est réservé à un usage NON commercial** — pour un
   produit payant, passer en Pro.
3. **Avant la mise en ligne** : `CRON_SECRET` fort pour `/api/cron/*`,
   HTTPS only (Vercel l'impose), vérifier le rate-limit (en mémoire :
   OK mono-instance ; multi-instances → passer sur Upstash).
4. **Persistance des uploads** : le stockage local `uploads/` ne survit
   pas aux déploiements serverless — basculer sur Vercel Blob ou S3
   (l'abstraction est isolée dans `src/server/uploads.ts`).

## Dashboards (v2.5 Module 1 — personnalisables)

> Module livré en 7 phases (audit → polish). Toutes les données restent
> scopées par utilisateur (`requireUser()` partout, index `userId`).

### Modèle de données (5 nouvelles tables)

`Dashboard` (max 8/user), `DashboardWidget` (max 24/dashboard ; config,
layouts et periodOverride en JSON validés par Zod), `CustomMetric`
(définition = agrégat + filtres + formule optionnelle),
`UserDashboardTemplate` (blueprints sauvegardés), `UserAppearance`
(1 ligne/user : palette, densité, couleurs custom, defaults KPI, config
focus). Push via `bun run db:push`.

### Architecture

- **Registre de widgets** (`src/lib/dashboard/registry.ts`) : chaque widget
  déclare type, catégorie, icônes, tailles min/max, schéma Zod de config,
  prérequis (`requires: prop|news|sync|goals|metrics`) et défauts. Point
  d'extension `registerWidget()` — les modules futurs (heatmap, exposure,
  trader score) s'ajoutent sans toucher au cœur. Types inconnus →
  placeholder « widget unavailable » (error boundary par widget).
- **Catalogue** : 25 widgets (KPI strip, single KPI, courbe d'équité,
  drawdown, calendrier P&L, positions ouvertes, trades récents, perf par
  session/jour/horaire, tables stratégie/instrument, histogramme R,
  win/loss, streak, objectifs, prompt journal, file de review, news à fort
  impact, statut PROP, sync, actions rapides, note markdown, métrique
  custom, comparaison de période).
- **Périodes par widget** (`src/lib/dashboard/period.ts`) : INHERIT /
  preset / N jours glissants / N derniers trades / plage custom +
  comparaison à la période précédente. `resolvePeriod()` pur, testé
  (semaines lundi, DST Toronto, bornes minuit local — bug noon/midnight
  trouvé par les tests puis corrigé).
- **Grille** : `react-grid-layout` 12 colonnes, breakpoints
  lg(780)/md(560)/sm(460) mesurés sur le conteneur ; drag/resize en mode
  édition uniquement (poignée header), compaction verticale, autosave
  debounced 600 ms + Undo + Reset. Mobile : pile une colonne, réordre par
  flèches. A11y : menu « Déplacer / redimensionner » au clavier (flèches,
  live region), RGL n'étant pas clavier-natif.
- **Normalisation des layouts** (`layout.ts`) : répare overlaps/hors
  limites, remplit les breakpoints manquants, `findFreeSlot()` pour le
  catalogue. Migration versionnée (`LAYOUT_SCHEMA_VERSION`).
- **Onglets** : plusieurs dashboards (dnd-kit pour réordonner), URL
  `#/?d=<id>&p=<preset>&a=<account>`, dernier ouvert mémorisé
  (localStorage), défaut étoilé, suppression impossible sur le dernier.
- **KPIs** : 24 indicateurs catalogués, jusqu'à 8 par strip, réordonnés
  dans la config, delta vs période précédente optionnel.
- **Métriques custom** (`src/lib/metrics/`) : parseur formule
  récursif descendant FAIT MAIN (aucun eval/new Function ; opérateurs
  + - * / ( ), fonctions min/max/abs/round, variables A/B/C, plafonds de
  complexité) + évaluateur sur decimal.js. Filtres en groupes AND /
  valeurs OR (instrument, stratégie, session, direction, tags, jour,
  plage horaire, émotion, résultat, compte, setup). Sample size affiché +
  warning < 10 trades. Ex : « win rate des trades session Londres sur
  XAUUSD ».
- **Focus mode** (`#/focus`, raccourci `F`) : horloge, sessions ouvertes,
  règles du jour, risque restant (perte journalière + trades/jour),
  limites PROP, positions ouvertes (R masquable), 3 gros boutons, note de
  plan (localStorage). Blocs configurables via `focusModeConfig`.
- **Apparence** (`#/reglages/appearance`) : palettes
  default / colorblind (bleu-orange Okabe-Ito) / deuteranopia /
  protanopia / monochrome / high-contrast / custom (3 colors + contraste
  WCAG vérifié + auto-adjust), densité COMPACT/COMFORTABLE/SPACIOUS
  (`data-density` → rowHeight/grille), palettes de charts. Tokens
  sémantiques `--gain/--loss/--neutral` (+ -bg/-border/-fg, variantes
  light/dark) — **aucune couleur gain/perte codée en dur** : test
  `tests/unit/no-hardcoded-pnl-colors.test.ts` échoue si une classe
  emerald/green/rose/red/lime/pink réapparaît dans dashboard/analytics/
  calendar/trade-bits/format (allowlist vide).
- **Import/export** : JSON versionné (Zod, ≤ 256 Ko, types inconnus
  rejetés proprement avec liste des éléments sautés), « Save as my
  template », 6 templates intégrés (Beginner, Scalper, Swing, Prop firm,
  Psychology, Minimalist) + dashboard par défaut porté de la vue v2.

### Decisions

- `AppearanceProvider` : fetch + état React (pas React Query) — le provider
  siège au-dessus de l'arbre applicative et doit se mettre à jour
  indépendamment du cycle de vie du cache de requêtes.
- Breakpoints RGL mesurés sur le CONTENEUR (viewport − sidebar) : la
  grille `lg` s'active dès ~780 px utiles au lieu d'attendre 1200 px de
  viewport ; sinon tous les widgets tombaient en `sm` (w ≤ 4).
- `reviewedPercent` calculé sur l'échantillon in-memory (un groupBy global
  ne peut pas donner le % des trades échantillonnés).
- Le remplacement du filtre de compte par widget (`accountOverride`)
  REMPLACE le filtre global (sémantique déclarée dans types.ts), le
  dataset de base est donc fetché non filtré puis filtré par widget.
- i18n : catalogues FR/EN maintenus en parité parfaite (2316 clés chacun)
  bien que l'UI soit anglaise par défaut (switcher retiré à la demande de
  l'utilisateur ; les liens de partage publics acceptent toujours ?lang=fr).

### Tests (31 fichiers, 511 tests)

Parser formule (précédence, erreurs, injections `process.exit`,
`__proto__`, `constructor`), évaluateur (agrégats, échantillons vides,
formules), resolvePeriod (DST, lundi, minuit local), normalisation
layouts, validité des templates (chaque widget enregistré, configs
valides, tailles dans les bornes), anti-couleurs-codées-en-dur, plus les
390 tests préexistants — aucune régression v1/v2/v3.

## Charts (v2.5 Module 2 — graphiques avancés)

### Audit (Section 0) — réutilisé vs ajouté

**Réutilisé tel quel :**
- Moteur d'analytics pur (`/src/lib/analytics/engine.ts` + `insights.ts`) :
  `computeTradeStats`, `computeEquityCurve`, tri chronologique, `StatTrade`.
- Mapping serveur TZ-aware (`localParts`) — les dimensions locales (heure,
  jour, semaine ISO, mois) sont calculées côté serveur dans le fuseau du
  profil, l'engine reste pur et déterministe.
- Recharts pour barres/lignes/aires/nuages ; tokens sémantiques
  `--gain/--loss/--chart-1..5` (test anti-couleurs étendu aux nouveaux
  composants via le même scope `components/analytics` + `components/charts`
  couvert par convention de code — seules des classes utilitaires sont
  vérifiées, les SVG utilisent `var(--…)`).
- Module 1 dashboards : `registerWidget()` (src/lib/dashboard/registry.ts)
  — les nouveaux charts seront enregistrés comme widgets en Phase 7.
- Modèle `PriceCandle` (schéma v2) — **aucun code ne l'utilisait** : le
  « price provider + import CSV candles » décrit dans la spec n'existait pas
  dans cette base ; il est construit ici (Phase 3).
- Champs Trade riches : MFE/MAE prix, `initialStopLoss`, `TradeExecution`,
  `TradeModification`, `TradeEventLink` (news), émotions, confiance, qualité
  de setup, `followedPlan`, tags (kinds SETUP/MISTAKE/CONTEXT/CUSTOM).
- `requireUser()` + pattern d'isolation userId (tests integration), wrapper
  `apiFetch`, TanStack Query, next-intl (catalogues FR/EN en parité, switcher
  retiré — décision Module 1 maintenue).

**Ajouté (Module 2) :**
- Tables : `SavedChart`, `ChartAnnotation`, `BenchmarkProfile` (userId, index,
  cascade) — validation Zod `/src/lib/validations/charts.ts`.
- Engines purs `/src/lib/charts/` : `builder.ts` (Phase 1), `price.ts`,
  `replay.ts` (Phases 3-4), `benchmark.ts`, `yearGrid.ts` (Phase 5),
  heatmap (Phase 2) — tous testés unitairement.
- `/api/charts/*` : `data` (payload builder), `saved` CRUD ; annotations et
  benchmarks dans leurs phases.
- Route hash `#/analytics/charts` (+ `heatmaps`, `annotations` à venir),
  entrée de nav « Chart builder », deep-link depuis #/analytics.
- `lightweight-charts` (TradingView, Apache 2.0) pour les chandeliers —
  attribution TradingView affichée dans le pied du graphique prix (Phase 3).

### Decisions (Phase 1 — builder)

- **Payload builder** : `GET /api/charts/data` renvoie les trades clôturés
  filtrés (cap 5000 + flag `truncated`), dimensions locales précalculées,
  MFE/MAE convertis en R côté serveur (`excursionR`). Le moteur pur tourne
  CÔTÉ CLIENT : chaque changement de config re-render instantanément sans
  requête supplémentaire.
- **Mesures « agrégat » vs « par trade »** : `winRate`, `expectancy`,
  `profitFactor`, `tradeCount`, `avgHoldingTime` sont calculées par catégorie
  (aucune agrégation supplémentaire — rejet Zod clair) ; les mesures par trade
  exigent une agrégation (sum/avg/median/min/max/count/percentile).
- **profitFactor infini** → null (non traçable) quand aucune perte.
- **Combinaisons invalides** : rejetées par `chartConfigSchema.superRefine`
  avec des codes stables traduits (ex. `requiresAggregation`,
  `scatterRequiresNumericX`) + double garde dans l'engine
  (`ChartConfigError`).
- **Drill-down** : les dimensions filtrables côté serveur (instrument, sens,
  session, timeframe, émotion, setup (recherche), résultat, date) ouvrent
  `#/trades?…` ; heure/jour-semaine locales passent par de nouveaux filtres
  `entryHour`/`entryWeekday` (post-filtre JS TZ-aware dans `listTrades`,
  fetch borné 5000 + pagination mémoire — SQLite n'a pas de TZ). Les
  buckets/tags/stratégies n'ont pas de filtre serveur : toast explicite et
  liste non filtrée (documenté dans l'UI).
- **Boîtes à moustaches** : SVG custom (Recharts n'a pas de box native) —
  focusable, aria-label par boîte, outliers 1.5×IQR.
- **Export PNG** : sérialisation du SVG + inline des variables CSS +
  canvas 2× — limitation connue : polices système (pas de webfonts embarquées).
- **Buckets** : durées (<5m…>24h), lots (<0.1…>5), risque % (<0.25…>2) —
  bornes documentées, clés i18n préfixées `hold_/lot_/risk_`.
- **Trade index / date** en X : séquence chronologique (tri par entryTime).
- **topN** : garde les N catégories par |valeur| puis re-trie selon le sort
  choisi (3-50).

### Tests (Phase 1)

`tests/unit/chart-builder.test.ts` (47 tests) : agrégations exactes
(decimal.js), médiane/percentile par interpolation linéaire, mesures
agrégat, buckets (bords exacts), fan-out tags/mistakes, group-by,
scatter+tendance+R², histogramme (borne max dans le dernier bin), box
(quartiles, moustaches, outliers), tri/topN/échantillon faible, combos
invalides (schema + engine), excursionR (LONG/SHORT, JPY/XAUUSD, fallback
SL final), drill-down, CSV, entrées vides.
`tests/integration/isolation-charts.test.ts` (3 tests) : isolation
SavedChart (CRUD scoped), annotations/benchmarks (pattern DB + cascade).

### Decisions (Phase 2 — heatmaps)

- **Moteur pur** `buildMatrix(trades, rowDim, colDim, metric, {minSampleSize, order})`
  réutilise `categoriesOf` du builder (fan-out multi-valeurs tags/mistakes
  inclus) — une seule source de vérité pour les dimensions.
- **Métriques** : expectancy R, P&L net, win rate, profit factor (null si ∞),
  trade count, R moyen — calcul exact Decimal, conversion nombre en sortie.
- **Échelle divergente** : `color-mix(in oklab, var(--gain|loss) X%, var(--card))`
  directement dans l'attribut SVG fill — suit automatiquement palettes/thème ;
  intensité compressée (0.25 + 0.75·ratio^0.7) pour la lisibilité.
  Indices redondants non-couleur : valeur numérique dans les cellules, n dans
  les totaux, hachures SVG pour l'échantillon faible.
- **maxAbs** calculé sur les seules cellules VALIDES (≥ min sample, défaut 5) ;
  avec 47 trades en jour × heure, la plupart des cellules sont hachurées —
  comportement voulu (l'utilisateur baisse le seuil ou choisit un preset plus
  grossier).
- **Navigation clavier** : le SVG est focusable, flèches = cellule, Entrée =
  drill-down ; info-bulle texte sous la matrice (aria-live) avec n, W/L et
  un avertissement « petit échantillon » sous 30 trades.
- **Drill-down cellule** : combine ligne + colonne (ex. `#/trades?entryWeekday=2&entryHour=4`)
  quand les deux dimensions sont filtrables ; toast si une dimension ne l'est
  pas (buckets, tags, stratégie…).
- **Chips de drill** dans la vue Trades : « Heure locale : 14h » / jour de la
  semaine, amovibles (reset du filtre correspondant).
- Snapshot plein écran : l'app-bar sticky apparaît en milieu de page — artefact
  de capture Playwright, pas un bug de layout.

### Tests (Phase 2)

`tests/unit/chart-heatmap.test.ts` (14 tests) : matrice vide, trade unique,
fan-out tags, bucketing heure locale (TZ), exclusion min-échantillon de
l'échelle (maxAbs), cellColor (divergence, compression, clamp), ordre
naturel/performance, totaux lignes/colonnes/grand total, CSV, cellules
creuses (n=0 aux intersections existantes).

### Decisions (Phase 3 — graphique de prix par trade)

- **lightweight-charts v5.3** (Apache-2.0). La lib n'impose pas d'attribution
  UI visible, mais le spec la demande : lien « Charting by TradingView
  lightweight-charts · Apache-2.0 » en pied de carte (et mention légale à
  venir en Phase 7). `layout.attributionLogo: false` (le nôtre est plus discret).
- **Couleurs → rgba par pixel** : la lib ne parse QUE hex/rgb/rgba alors que
  les tokens calculés sortent en oklch()/lab() (Chromium). `cssVar()` peint
  un pixel 1×1 et relit les octets RGBA — le round-trip `fillStyle` seul
  conserve la sérialisation lab(). L'AttributionLogoWidget parse textColor
  même désactivé → tout passe par la normalisation.
- **Fenêtre & ré-échantillonnage** : `GET /api/charts/candles` renvoie les
  lignes au timeframe le plus FIN stocké ≤ celui demandé (cap 6000 barres,
  les dernières de la fenêtre) ; le client ré-échantillonne via `resample()`
  (buckets UTC absolus — pas d'ambiguïté DST ; trous/week-end préservés).
  `storedTimeframes` est renvoyé pour l'aide à la sélection.
- **Import CSV** : `POST /api/charts/candles/import` — papaparse côté serveur,
  colonne time flexible (unix s/ms, « AAAA-MM-JJ HH:mm », ISO), fuseau
  DÉCLARÉ (IANA ou ±HH:MM) converti en UTC avec offset recalculé PAR LIGNE
  (DST), dédoublonnage sur (instrument, tf, openTime) — `skipDuplicates`
  n'existe pas sur SQLite → filtrage manuel + createMany par lots de 500.
- **Budget stockage** : cap 50k lignes/import, 250k lignes/instrument+tf
  (élagage des plus anciennes), ET élagage des chandeliers > 365 jours hors
  fenêtres de trades (± 5 jours) — le stockage reste borné aux fenêtres
  réellement tradées (contrainte 500 Mo).
- **Overlay** : `buildTradeOverlay()` pur — marqueurs entry/add/partial/exit
  (+ news liées), lignes Entry/SL initial (pointillé)/TP initial/SL final/TP
  final, marches de SL déplacé (TradeModification) + `slAt()` pour le replay.
  Les zones risk/reward ombrées ne sont pas natives en lightweight-charts :
  remplacées par des lignes de prix étiquetées (décision documentée).
- **Onglet paresseux** : `next/dynamic` + `ssr: false` — le bundle
  lightweight-charts ne se charge qu'à l'ouverture de l'onglet « Price chart ».
- **DTO étendu** : TradeDetailDTO + `modifications` + `newsEvents`
  (mapper défensif `?? []`, include partagé `DETAIL_INCLUDE` pour éviter la
  divergence des include inline — bug attrapé par les tests sharing-flow).

### Tests (Phase 3)

`tests/unit/chart-price.test.ts` (21 tests) : resample (buckets UTC, merge
OHLCV, trous week-end, volume null), finestFor, coverage (bornes ± 1 tf,
gap max), overlay (LONG/SHORT, exécutions, marches SL, slAt chronologique,
news), parseCandleRow (unix s/ms, heure murale + offset déclaré, ISO Z,
décimales JPY/XAUUSD, lignes invalides), tzOffsetMinutes (DST Toronto/Paris),
isValidTimezone.

### Decisions (Phase 4 — replay du trade)

- **Machine à états pure** `createReplayEngine(candles, trade, {pipSize,
  preEntryBars})` : `step/seek/setPlaying/setSpeed` purs, `snapshot(state)`
  expose `visible = candles[0..cursor]` — le composant n'envoie JAMAIS au
  chart des bougies au-delà du curseur (no look-ahead structurel).
- **Hypothèses intrabarre documentées** (l'ordre SL/TP/fill est inconnu en
  OHLC) : (1) MFE/MAE cumulés = extrêmes des bougies vues (exact pour des
  extrêmes cumulés) ; (2) une bougie touchant SL **et** TP → drapeau
  `slTpBothTouched` + panneau « ordre intrabarre inconnu » ; (3) position
  ouverte à la bougie contenant l'entrée, clôturée à partir de la bougie
  contenant la sortie (résultat réalisé lu sur le trade).
- **Overlay réutilisé** : le player construit un `cursorTrade` (SL courant
  via `slAt`, exécutions/news/modifications filtrées au curseur, sortie
  révélée quand atteinte) et repasse le tout dans `buildTradeOverlay` —
  une seule implémentation d'overlay.
- **Mode pré-entrée** : démarre N bougies avant l'entrée, masque le SL/TP
  initial et la position (jugement à l'aveugle), révèle à l'entrée.
- **Contrôles** : play/pause, pas-à-pas, vitesse 0.5×→10× (bougies/s),
  scrubber (Slider), sauts entrée/MFE/MAE/sortie (indices calculés par le
  moteur), clavier (Espace, ←/→) sur un groupe focusable aria-labelé.
- **Bannière honnête** : la qualité du replay dépend du timeframe et de la
  couverture (texte i18n), toujours affichée.
- Boucle de lecture : `setInterval` global (le `window.setInterval` bundlé
  n'existe pas dans ce contexte Turbopack — bug attrapé en vérification
  navigateur).

### Tests (Phase 4)

`tests/unit/chart-replay.test.ts` (17 tests) : no look-ahead, clamp curseur,
pré-entrée (position masquée), pips/R flottants (LONG + SHORT), MFE/MAE
cumulés, distances SL/TP, clôture à la bougie de sortie, SL mobile
(modifications), événements atteints (partial/news), ambiguïté SL+TP même
bougie, transitions pures play/speed, temps en trade, indices MFE/MAE,
candles vides → erreur.

### Decisions (Phase 5 — benchmark + calendrier annuel)

**Benchmark (4.5)** :
- Engines purs `benchmark.ts` : `buildFixedBenchmark` (% fixe composé/linéaire,
  R fixe par période, bornes UTC — DST ne déplace pas les bordures de période
  calendaires UTC ; dernière période PARTIELLE au prorata), `compareEquityToBenchmark`
  (normalisation base 100 au départ commun, fonction EN ESCALIER sans
  interpolation — documenté), périodes battues, `requiredMonthlyReturn`
  (composé), `projectionCone` (moyenne ± 1σ des rendements mensuels réels,
  hypothèse i.i.d. étiquetée dans l'UI), `monthlyReturns` (mois calendaires
  LOCAUX).
- Profils multiples persistés (BenchmarkProfile) + profil « défaut 1 %/mois
  composé » calculé à la volée ; série personnalisée importée en CSV
  date,valeur (≤ 2000 points, dates triées).
- Équité : convention v1 conservée (initialBalance + P&L clôturé cumulé,
  dépôts/retraits exclus).
- UI #/analytics/benchmark : sélecteur de profil + CRUD, courbe comparative
  double (tokens chart-1/chart-3), stats (écart final, % périodes battues),
  calculateur d'objectif (mois restants de l'année), cône 12 mois.
- Deux bugs attrapés par les tests : `valueAt` lisait `.value` sur des points
  équité (`.equity`) → normalisation de forme ; le point final de série
  poussait un objet Date comme chaîne (comparaisons lexicales cassées).

**Calendrier annuel (4.6)** :
- `yearGrid.ts` pur : grille 7 × N semaines (52 ou 53 — 2024 bissextile = 53),
  jours hors année grisés (semaines complètes), labels de mois à la première
  colonne, métriques (P&L net, R, nb trades, W/L, journal, discipline v1),
  échelles divergente/séquentielle/binaire + tons (gain/loss/neutre/muted,
  intensité 0.25 + 0.75·ratio^0.6).
- Serveur `getYearDays` : agrégats journaliers de l'année (jours locaux à la
  clôture, même convention que la vue mois) + journal rempli + score de
  discipline. `GET /api/calendar/year?year&account`.
- UI : toggle Mois/Année dans #/calendrier, sélecteur d'année (6 ans),
  sélecteur de métrique, SVG custom (cells cliquables → #/journal/{date},
  navigation clavier flèches + Entrée, focus visible), labels de mois
  localisés, début de semaine par locale (lundi/dimanche), légende adaptée à
  l'échelle, vue tableau accessible.

### Decisions (Phase 6 — annotations)

- **Manager dédié** `#/analytics/annotations` : courbe d'équité annotée
  (lignes verticales pointillées = ponctuelles, bandes translucides =
  plages, couleur par type avec tokens), création EN CLIQUANT la courbe
  (point du trade → date), CRUD complet, filtre par type, bascule de
  visibilité par annotation, stats avant/après en panneau dédié. Les
  annotations font partie du SVG → incluses dans l'export PNG.
- **Portée** : GLOBAL (tous les graphiques), ACCOUNT, STRATEGY — un
  filtre de compte/stratégie actif n'affiche que les annotations
  correspondantes (plus les globales) ; `annotationApplies()` pur.
- **Avant/après** : split sur la date de SORTIE locale (`localDate`,
  convention d'attribution P&L des analytics) ; annotation PONCTUELLE :
  after = depuis la date ; PLAGE : la plage est exclue des deux côtés.
  Stats : n, win rate, espérance (R), P&L net, drawdown max (via
  `computeTradeStats` réutilisé) + avertissement « non significatif »
  sous 30 trades d'un côté.
- **PATCH Zod v4** : `.partial()` interdit après refinements → le serveur
  fusionne le patch sur la ligne stockée puis REVALIDE l'objet complet
  avec `annotationInputSchema` (les règles croisées de portée tiennent
  après fusion).
- Les annotations sur les charts temporels du builder (X = date) ne sont
  pas rendues : X catégoriel par date locale ≠ axe temporel continu —
  les annotations vivent sur la courbe d'équité (manager + à venir sur
  le benchmark), décision documentée.

### Tests (Phase 6)

`tests/unit/chart-annotations.test.ts` (7 tests) : portée GLOBAL/ACCOUNT/
STRATEGY (compte alloué, filtres actifs), split point (after inclusif) et
plage (exclusive), win rate/espérance/drawdown par côté, côtés vides,
avertissement petit échantillon.

### Phase 7 — enregistrement dashboard, QA finale

**Widgets (spec §5/§7)** :
- `register-chart-widgets.ts` enregistre les trois charts via le point
  d'extension Module 1 `registerWidget()` — le cœur du dashboard n'est pas
  touché. Tous SELF-FETCHING (`hasLoader: false`) : ils tirent leurs données
  de `/api/charts/*` et `/api/calendar/year` via TanStack Query.
- **saved-chart** (analysis, requis `savedCharts` — le catalogue désactive
  le bouton tant qu'aucun chart n'est enregistré) : valide le config stocké
  avec `chartConfigSchema` (double garde avec l'engine), honore le contexte
  de filtre sauvegardé (period + account), re-render via `buildChart` +
  `ChartPreview` côté client — zéro requête supplémentaire par changement.
- **heatmap** : `buildMatrix` + `HeatmapMatrix` réutilisés tels quels ;
  dims dérivées de `X_DIMENSIONS` (moins tradeIndex) — source unique.
- **year-calendar** : SVG compact (cellules 11px) reconstruit sur
  `buildYearGrid`/`cellTone`/`metricScale` (métrique P&L net, année
  courante), navigation clavier flèches + Entrée, info-bulle accessible.
- **ChartPreview** accepte un `height` optionnel (défaut 340 — la page
  builder est inchangée) : les widgets passent la hauteur dérivée de la
  grille (`max(160, h*40-110)`).
- Import de side-effect (idempotent) dans le renderer, le catalogue, la
  vue dashboards, la validation serveur (`server/dashboards.ts`) ET les
  tests unitaires — partout où `getWidgetDefinition`/
  `safeParseWidgetConfig` est consulté.
- Dialog de config : sélecteur de chart enregistré (vide → CTA vers le
  builder), champs heatmap (lignes/colonnes/métrique/seuil échantillon),
  year-calendar sans réglages.

**QA type** (le dev server Turbopack ne typecheck pas — `tsc --noEmit`
a révélé des erreurs des phases 3-6, toutes corrigées) :
- `apiErrorMessage(error)` appelé à 1 argument (5 sites) → pattern
  correct `apiErrorMessage(tRoot, err?.code, message)` avec
  `ApiClientError`.
- `replay-player` : `state: ReplayState | null` non narrowing après le
  garde `snap` → garde explicite `!engine || !state || !snap`.
- `replay.ts` : `bestIdx`/`worstIdx` inférés `null` → `number | null`.
- `toTradeDetail` : paramètre élargi `TradeDetailRow` (modifications/
  eventLinks optionnels, review `{id}`) — les vues mentor avec un include
  plus léger typent sans cast.
- `updateAnnotation` : `kind`/`scope` DB (string) castés vers les unions
  puis REVALIDÉS par `annotationInputSchema` après fusion.
- `drillToTradeFilters` émettait `timeframe` mais le filtre n'existait
  ni dans `tradeListQuerySchema` ni dans `tradeListWhere` → ajouté dans
  les deux + chip de drill « Unité de temps » dans la vue Trades.
- `onDrill && …` toujours vrai (fonction locale) → condition retirée.
- i18n manquant révélé en vérification navigateur : `common.error`,
  `common.refresh` (utilisés par les toasts d'erreur et les boutons
  refresh des vues benchmark/price) — ajoutés EN+FR.

**Mentions légales** : section « Licences open source » sur
`#/legal/mentions` — attribution TradingView lightweight-charts
(Apache-2.0) + Recharts (MIT), complément du pied de carte du graphique
prix (Phase 3).

**Vérification navigateur** (Agent Browser, user démo) : catalogue →
« Requires: a saved chart » (gating), ajout heatmap + year calendar +
saved chart, rendu confirmé (184 cellules heatmap avec valeurs R et
légende, 371 cellules calendrier, 16 barres Recharts vertes/rouges),
drill-down heatmap → #/trades, onglets Price chart (attribution
TradingView, canvas rendu avec les 53 bougies M5 XAUUSD, état vide →
CTA import CSV sinon) et Replay (play/pause transition d'état), vue
Trades chips de drill, mentions légales, aucun `MISSING_MESSAGE`
résiduel après rechargement, pas d'overflow horizontal (1280px et
390px), footer collant en bas sur mobile, aucun crash console.

# Productivity (v2.5 Module 4 — ergonomie & productivité)

Section vivante : décisions d'architecture et limites documentées phase par
phase. Objectif du module : raccourcis personnalisables, recherche globale,
vues sauvegardées avancées, édition groupée + undo/redo, corbeille, champs
personnalisés, colonnes configurables, saisie par lots, dictée vocale, PWA.

## Phase 1 — Corbeille (soft delete) — ✓

### Périmètre des entités
Soft delete (`deletedAt`, `deletedBy`) sur les entités de CONTENU :
`Trade`, `JournalEntry`, `Strategy`, `Tag`. Les entités structurelles
(`Account`, `Instrument`, `TradingRule`, templates…) gardent le hard delete —
elles sont référencées partout par FK et une suppression douce généralisée
empoisonnerait chaque lecture.

### Mécanisme : extension client Prisma
`src/lib/trash/extension.ts` injecte `AND { deletedAt: null }` dans **tous**
les reads par défaut des 4 modèles (findMany/findFirst/count/aggregate/
groupBy/updateMany) — le code applicatif n'a RIEN à savoir. `findUnique` /
`findUniqueOrThrow` ne pouvant pas recevoir de filtre additionnel : post-check
du résultat (avec `deletedAt` forcée dans le `select` partiel puis retirée) —
une ligne trashed se comporte comme « introuvable » (null / P2025).

Échappatoire : `withDeleted(() => …)` (AsyncLocalStorage) — réservé au module
corbeille et à la déduplication import/sync. **Piège documenté** : le
callback de `withDeleted` est wrappé en `async` — les extensions client
Prisma diffèrent `$allOperations` d'au moins un microtask, donc un callback
SYNCHRONE voit son scope `storage.run` se refermer avant que l'extension ne
le lise (vérifié empiriquement sous bun et vitest).

Limites assumées : les writes explicites (create/update/upsert/delete) ne
sont PAS interceptés — chaque chemin serveur lit la ligne d'abord (lecture
elle-même filtrée) ; les includes relationnels (`include: { trades: true }`)
bypassent les extensions de modèle — audit grep : ZÉRO include imbriqué de
trades dans le code serveur (à maintenir). Les références à des entités
trashed (stratégie taguée sur un trade vivant) sont filtrées dans les DTO :
`strategyId`/tags masqués jusqu'à restauration (analytics incluses).

### Clé unique (accountId, externalId) vs corbeille
Une ligne trashed CONSERVE sa clé de dédup import/EA. Règle (testée) :
- Import de fichiers : la recherche tourne dans `withDeleted` ; un match
  trashed est **restauré** puis mis à jour (compteur `restored`), jamais
  dupliqué, jamais P2002. Un twin trashed de source `MANUAL` suit la même
  règle restore-then-update.
- EA sync : un OPEN re-annoncé restaure une position trashed encore OPEN ;
  la clôture réelle d'une position trashed OPEN la restaure ; les replays
  d'un ticket déjà CLOSED ne ressuscitent rien (idempotence préservée).

### Rétention & purge
30 jours (badge « jours restants » dans l'UI). Cron quotidien existant
(`runDailyMaintenance`, étape 8) : purge hard-delete **par chunks** (find ids
→ delete ids), suppression des lignes `TradeScreenshot` + des dossiers
`uploads/{userId}/{tradeId}/`, pruning des `ChangeLog` expirées. Idempotent.

### Réindexation searchText (préparation Phase 4)
SQLite n'a ni tsvector, ni unaccent, ni pg_trgm. Équivalent maintenu :
colonne `searchText` (concat pliée NFD → sans diacritiques → minuscule) des
champs cherchables, recalculée à CHAQUE écriture via
`src/server/search-index.ts` (trades, journal, stratégies — y compris chemins
import/EA). Chemin de migration Postgres : index GIN pg_trgm sur la même
colonne (aucun changement de contrat).

### Journal — piège de l'upsert
`upsertJournalEntry` tourne dans `withDeleted` et pose `deletedAt: null` sur
l'update : réécrire un jour trashé RESTAURE l'entrée (sinon l'upsert
écrirait une ligne invisible).

### Nouvelles tables (RLS ajoutée dans prisma/rls.sql)
`KeyboardShortcut`, `TableColumnPreference`, `CustomFieldDefinition`,
`ChangeLog`, `BatchEntryDraft` (schéma posé en Phase 1, consommées par les
phases suivantes) ; `SavedView` étendue (entity, columns/sort/grouping JSON,
isPinned, isDefault, order, version). `Trade.customFields` (JSON) posé.

### UI
`#/trash` (vue + nav + palette) : filtres par entité avec compteurs,
recherche (pliée, LIKE sur searchText), sélection multiple + barre d'actions
groupées, restauration, suppression définitive (confirmations dédiées),
« vider la corbeille », badge jours restants. Copies i18n des dialogues de
suppression (trades/journal/stratégies) mises à jour : « déplacé dans la
corbeille, restaurable 30 jours ».

### Tests (tests/integration/trash.test.ts)
Régression spec (« jamais dans les stats ») : trade trashed absent de
listTrades (+ recherche), détail 404, analytics, export CSV, calendar,
reads bruts, **transactions interactives**, findUnique (null) ; updateMany
ne touche pas les trashed ; deleteTrade = soft + enfants conservés ;
restore round-trip ; stratégie/tag trashed masqués des DTO + breakdowns puis
restaurés ; journal upsert-restore ; purge (31 j → hard delete + screenshots
+ ChangeLog ; 3 j → conservé ; idempotent) ; contrainte unique documentée ;
isolation inter-utilisateurs (list/restore/delete permanents).

### Limites documentées
- SQLite : LIKE séquentiel par utilisateur (volumes perso) — path pg_trgm
  documenté ci-dessus.
- Le compteur d'usage des tags (vue tags) compte via _count non filtrable :
  les trades trashed gonflent le compteur jusqu'à purge (cosmétique, ticket
  en Phase 3 avec les colonnes configurables).
- PWA widgets : voir Phase 7 (à venir) — honnêteté plateforme dans le README
  prévue (iOS/Android n'exposent pas de vrais widgets PWA).

## Phases suivantes (plan)
2. ChangeLog/undo/redo + édition groupée · 3. Champs personnalisés +
colonnes configurables + vues avancées · 4. Recherche globale · 5. Registry
raccourcis + cheat sheet · 6. Saisie par lots · 7. PWA shortcuts/share
target/badging + dictée · 8. Polish (i18n, a11y, perfs).

## Privacy & accessibility (v2.5 Module 8)

### Décisions d'architecture
- **Règle du point d'étranglement unique (§1)** : tout affichage monétaire passe
  par `<Money />` / `<Sensitive />` (`src/components/privacy/money.tsx`) ou
  `useFormat()` (`src/lib/format/use-format.ts`). Les formateurs historiques
  `fmtMoney` / `fmtSignedMoney` / `fmtPct` (`src/lib/format.ts`) consultent le
  store privacy et renvoient le placeholder en mode HIDE — ils restent le seul
  endroit où un montant peut être formaté. **Ratchet** :
  `tests/unit/no-direct-money-formatting.test.ts` échoue si un fichier hors
  des modules autorisés appelle ces fonctions ou construit un format monétaire
  `Intl` à la main.
- **Réactivité sans re-render global (§6)** : le store privacy est un external
  store (subscribe/snapshot, `src/lib/privacy/store.ts`). `<Money>` et les
  composants qui appellent `useFormat()` s'abonnent individuellement — le
  toggle ne re-render QUE les valeurs sensibles, jamais l'arbre entier. Le mode
  BLUR est purement CSS (`data-privacy="blur"` sur `<html>` + `.sensitive`).
- **Persistance double (§2)** : localStorage par appareil (application
  instantanée, pre-paint script) + ligne `UserDisplayPreference` par utilisateur
  (sync debounced via `PUT /api/display-preferences`, patches partiels — les
  slices privacy / a11y / time ne s'écrasent pas entre elles). À la première
  utilisation sur un appareil la valeur serveur est adoptée ; ensuite
  l'appareil gagne (override par appareil).
- **Équité courante vs mini-carte** : la courbe d'equity bascule
  automatiquement en axe POURCENT en mode HIDE (spec §3.1) — jamais la vraie
  échelle monétaire n'est tracée ; les autres axes monétaires affichent le
  placeholder par tick.
- **Exports** : le CSV d'export contient les valeurs réelles PAR CONCEPTION
  (export de données) — un dialogue avertit explicitement quand le mode
  confidentialité est actif (« l'export contient les VRAIES valeurs »).
- **Notifications (§3.1)** : `hideAmountsInNotifications` (serveur) redonne les
  titres/corps via `redactAmountsInText()` avant persistance — défense en
  profondeur pour les futurs canaux PUSH/EMAIL composés des mêmes chaînes.
- **Redaction v3 réutilisée** : les liens de partage et l'export anonymisé
  restent LA voie pour masquer réellement des données auprès de tiers
  (redaction structurelle serveur) — le mode privacy ne remplace pas ça.

### Limites documentées (honnêteté)
- **Le mode confidentialité est une commodité d'AFFICHAGE, pas un contrôle de
  sécurité** : les données restent présentes dans le source de la page et les
  réponses réseau. Pour masquer réellement : liens de partage v3 (redaction
  serveur) ou export anonymisé.
- **Un web app ne peut pas détecter de façon fiable un partage d'écran** —
  aucune détection n'est promise ; le toggle manuel (Shift+H) et le preset
  « présentation » couvrent ce cas d'usage.
- **Mode BLUR** : le texte réel reste dans le DOM (devtools, copie,
  lecteurs d'écran) — c'est un flou visuel, documenté dans l'UI.
- Le raccourci clavier n'est pas actif pendant la saisie dans un champ.

### Tests (Phases 1-2)
`privacy-policy.test.ts` (store, policy, formatters), `privacy-dom-leak.test.tsx`
(jsdom : `<Money>`/`<Sensitive>` en HIDE — aucun motif monétaire du fixture
dans le texte/attributs DOM, sr-only « amount hidden », BLUR garde le texte +
classe), `no-direct-money-formatting.test.ts` (ratchet, liste vide),
`time-utilities.test.ts` (DST hémisphères nord/sud, semaines de décalage
US/EU, bascules GMT+2/GMT+3 « New York close », fuseaux à demi-heure,
affectation des jours au rollover, round-trips), `a11y-contrast.test.ts`
(WCAG math + palettes — `loss-fg` colorblind assombri #9c7100 → #8f6700 pour
passer AA), `isolation-display-preferences.test.ts` (scoping utilisateur,
merge des slices, cascade delete, colonnes serveur/instrument).
