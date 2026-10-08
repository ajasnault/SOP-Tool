# Formules de calcul S&OP

Implémentation : `server/src/calc/`. Toutes les périodes sont des mois calendaires
(`YYYY-MM`), sauf mention contraire. Les durées sont en heures.

## Demande consolidée

`demandeConsolidee(groupBy: famille|produit|marché, period: mois|trimestre)`

Somme de `forecasts.forecast_qty_units`, groupée par la dimension demandée.
La famille vient de `products.family` (jointure sur `product_id`). Le trimestre
regroupe 3 mois calendaires (`2026-01..03` → `2026-Q1`).

## Capacité disponible d'une machine sur une période

```
heures_calendaires(période)                            — ex. 31 jours × 24h pour janvier
− heures_maintenance(machine, période)                 — somme de duration_hours des maintenance_plans
                                                           dont planned_date tombe dans la période
− heures_arrêt(machine, période)                        — somme de (durée_arrêt_en_heures × impact_capacity_pct / 100)
                                                           pour les shutdowns dont (site, production_line)
                                                           correspond à la machine et dont l'intervalle
                                                           [start_date, end_date] chevauche la période
= capacité_disponible_heures, plancher à 0
```

**Hypothèse de rattachement des arrêts** : un `shutdown` s'applique à une machine
si `shutdown.site == machine.site` ET `shutdown.production_line == machine.production_line`
(un arrêt est déclaré par site/ligne, pas par machine individuelle — toutes les
machines de la ligne concernée sont donc considérées à l'arrêt).

**Hypothèse maintenance non exclusive** : les heures de maintenance et d'arrêt sont
soustraites indépendamment (pas de déduplication si elles se chevauchent dans le
temps) — cas rare dans le jeu de test, mais à corriger si les vraies données
combinent souvent les deux.

## Temps de production planifié

Pour chaque `production_orders` rattaché à une machine et démarrant dans la période :

```
temps_of_heures = batch_qty_units / machine.capacity_per_hour_units
                + machine.changeover_time_hours   si l'OF précédent sur la même machine
                                                   (ordre de planned_start) porte un autre produit,
                                                   ou s'il n'y a pas d'OF précédent
                + machine.line_clearance_hours    sinon (même produit)
```

**Vide de ligne obligatoire** (depuis le 2026-10-08) : en GMP, aucun OF ne
démarre sans vide de ligne, même après un lot du même produit (retrait des
articles, documents et étiquettes du lot précédent, vérification). Au
changement de produit, le changement de série (nettoyage complet) inclut le
vide de ligne : on ne cumule pas les deux. `line_clearance_hours` vide (jeux
antérieurs) = 0. Calculé en SQL avec `LAG`, sur tout l'historique de la
machine, via l'index couvrant `idx_production_orders_seq`. Avant cette date, le
changement de série était compté sur chaque OF quel que soit le produit.

**Rattachement à un mois** : l'intégralité du temps de l'ordre est comptée sur le
mois de `planned_start` (pas de prorata si l'ordre chevauche deux mois). C'est
pourquoi le goulot d'un plan ordonnancé à capacité finie peut afficher
légèrement plus de 100 % (ex. 100,1 %) : un OF commencé le 31 au soir compte en
entier sur le mois.

## Taux d'utilisation planifié

```
utilisation(machine, période) = temps_production_planifié_heures / capacité_disponible_heures
```

Non défini (`null`, affiché comme "n/a") si `capacité_disponible_heures == 0`.

## Détection de gap

Toute machine/période avec `utilisation > seuil` (table `alert_thresholds`,
clé `capacity_utilization_gap_pct`, défaut 90 %) est remontée comme point
d'attention.

## Disponibilité RH

```
disponibilité(équipe, rôle, site, période) = Σ fte(employés du groupe)
                                            − Σ fte(employé) × fraction_absente(employé, période)
```

`fraction_absente` = proportion de jours de la période couverts par une ou
plusieurs `absences` de l'employé (bornée à 1). **Pas de charge réelle** : aucune
donnée ne lie un employé à un ordre de fabrication précis, donc seule la
disponibilité est calculée (cf. `docs/data-model.md`).

## Taux de service prévisionnel

```
disponible(produit, mois) = Σ batch_qty_units des lots finis du produit disponibles dans le mois
couvert(produit, mois)    = min( disponible(produit, mois), Σ forecast_qty_units du produit sur le mois )
taux de service(mois)     = Σ couvert(produit, mois) / Σ demande(produit, mois) × 100
```

**Lot fini disponible** (depuis le 2026-10-08, gammes) :
- plan avec gamme (`step_no` renseigné et gamme importée pour le produit) :
  seul l'OF de la **dernière étape de la gamme** produit du fini (un lot qui
  passe par 5 machines n'est compté qu'une fois). Il est disponible au mois de
  sa **libération QC** (`quality_results.release_date` de cette étape), sinon
  au mois de `planned_end`. Un lot avec un résultat « Hors spécifications » à
  n'importe quel point de contrôle est exclu ;
- plan sans gamme (`step_no` vide, jeux antérieurs, ou produit sans gamme) :
  chaque OF est un lot fini, disponible au mois de `planned_end` (calcul d'origine).

Ordres "Reporté" exclus dans les deux cas. Couverture **plafonnée produit par
produit** : le surplus planifié d'un produit ne compense jamais le déficit d'un
autre. Filtre site = site du produit. `null` si le mois n'a aucune demande.

C'est un taux de service **prévisionnel** (plan vs demande), pas un taux de
service réalisé : celui-ci nécessiterait des données de livraison. Cible
configurable : seuil `service_level_target_pct` (défaut 95 %).
Valeurs sur le jeu « flux + QC » (généré le 2026-10-08) : 96,4 % en septembre
2026, 63,3 % en octobre (choc de demande, goulots saturés), 75,5 % en novembre,
82,4 % en décembre, 97,4 % en janvier 2027 (le retard se résorbe).

## Flux et goulot

Vue "Flux & qualité". Les gammes (`routings`) sont regroupées par site et par
enchaînement de types de machines (ex. Granulateur → Presse → Enrobeuse →
Blister → Encartonneuse) ; chaque étape porte l'utilisation du mois de ses
machines :

```
utilisation(étape, site, mois) = Σ heures planifiées / Σ heures disponibles
                                 des machines du site de ce machine_type
goulot(flux, mois)             = étape d'utilisation maximale
```

Le goulot fixe le débit de toute la chaîne en aval : dans un plan ordonnancé à
capacité finie, les étapes en aval d'un goulot saturé sont sous-chargées (elles
attendent ses lots). Une même machine (ex. l'encartonneuse, commune à tous les
flux d'un site) apparaît dans plusieurs flux avec la même utilisation.

## Contrôle qualité

Fenêtre glissante de 3 mois se terminant au mois du cycle, sur les résultats
**décidés** (`Conforme` / `Hors spécifications`), rattachés au mois de leur
`release_date` :

```
taux de rejet          = nb Hors spécifications / nb contrôles décidés
valeur perdue          = Σ (quantité du lot × standard_cost_eur_per_unit) des lots rejetés
délai réel (point QC)  = moyenne de (release_date − sample_date)
délai prévu (point QC) = moyenne de routings.qc_lead_time_mean_hours sur les MÊMES lots
```

Le délai prévu est pondéré par lot, pas moyenné par gamme : sinon 336 h
(injectables, test de stérilité) et 48 h (façonnage) pèseraient pareil quel que
soit le nombre de lots contrôlés. « Produits les plus rejetés » : au moins 5
contrôles décidés dans la fenêtre. Les contrôles `En cours d'analyse` sont
comptés à part (file d'attente du laboratoire à la date d'extraction). Les
lots planifiés au-delà ne sont pas encore contrôlés : le plan les suppose
conformes, et compense par un surplus de lots (voir data-model.md, jeu « flux + QC »).

## Mois de référence du cycle (`cycleReferenceMonth`)

Introduit le 2026-08-20 pour remplacer l'ancien `currentMonth` (résolution
automatique avec repli sur le dernier mois actif) par une notion unique,
navigable, qui ancre à la fois le scorecard, la revue capacité, l'axe des
graphiques et l'export PPTX. Résolution (`resolveCycleReferenceMonth`,
`server/src/calc/index.ts`) :

1. le mois demandé explicitement (paramètre `cycleReferenceMonth` de l'API),
   s'il y en a un ;
2. sinon, le mois calendaire réel actuel.

Dans les deux cas, le résultat est borné à `dataHorizon` (tous les mois avec
au moins une donnée forecast ou plan de production) : demander un mois hors
de cette plage le ramène à la borne la plus proche plutôt que d'échouer ou
d'afficher un cycle totalement vide. `isCurrentCycle` indique si le mois
retenu est le mois calendaire réel actuel (sert au badge "Aujourd'hui" côté
présentation) — contrairement à l'ancienne logique, ce mois n'est **pas**
automatiquement remplacé par un mois "avec de l'activité" : si le mois réel
actuel n'a pas de plan de production, le scorecard affichera des zéros avec
le badge "Aujourd'hui", et l'utilisateur peut naviguer manuellement vers un
mois qui en a. C'est un choix délibéré : la navigation entre cycles rend
inutile le repli automatique qui existait avant elle.

**Horizon des graphiques vs bornes de navigation.** Deux notions distinctes
dans `DashboardSummary` :
- `dataHorizon` — tous les mois avec une donnée réelle ; sert uniquement à
  griser la navigation aux bornes (pas de cycle totalement vide).
- `chartHorizon` — exactement 18 mois consécutifs à partir de
  `cycleReferenceMonth` (`rollingMonths`, `server/src/calc/period.ts`), qu'il
  y ait ou non des données sur toute cette plage. C'est l'axe affiché par la
  revue de la demande : `demandTrend`/`demandByFamily` sont complétés à 0
  pour les mois de `chartHorizon` sans forecast, plutôt que d'omettre ces
  mois — l'horizon avance visiblement avec le calendrier même si les
  prévisions n'ont pas encore été saisies aussi loin (signal honnête d'un
  processus roulant, pas un bug à masquer).

**Limite assumée : pas d'archivage figé par cycle.** Naviguer vers un cycle
passé **recalcule les données actuelles à travers le prisme de ce mois** — ce
n'est pas un instantané de ce qui était affiché à l'époque. Si les données
sources ont été réimportées ou corrigées depuis, la vue d'un ancien cycle
reflète l'état présent des données, pas l'état historique réel au moment de
ce cycle. Décision volontaire pour rester simple : un vrai archivage figé par
cycle (snapshot immuable à chaque clôture de cycle) serait une évolution
future, hors de ce lot.

## Période gelée

Repère visuel/organisationnel — **n'empêche aucune écriture en base**, ne
filtre ni ne verrouille rien. Paramètre `frozen_period_weeks` (seuil
générique, défaut 8 semaines, `server/src/routes/dashboard.ts` /
`alert_thresholds`). Calcul (`monthAfterWeeks`, `server/src/calc/period.ts`) :

```
frozenPeriodEndMonth = mois contenant (1er jour de cycleReferenceMonth + frozen_period_weeks × 7 jours)
```

**Granularité mensuelle assumée** : la période gelée est bornée aux mois
entiers de `cycleReferenceMonth` à `frozenPeriodEndMonth` inclus, pas au jour
près — cohérent avec le fait que les données de capacité/demande sont
elles-mêmes mensuelles ; une précision journalière serait une fausse
précision.

**Pourquoi le marqueur n'apparaît que sur le graphique de demande** : c'est
la seule vue avec un véritable axe temporel continu (18 mois glissants). La
revue de capacité affiche un seul mois à la fois (liste de machines, pas de
chronologie) — y marquer "ce mois est gelé" serait toujours vrai par
construction (la période gelée démarre justement à `cycleReferenceMonth`),
donc non informatif. Pas de marqueur non plus sur le graphique de répartition
par famille (agrégation trimestrielle, trop grossière pour représenter
fidèlement une période de quelques semaines).

## Heatmap d'évolution de charge (machines × mois)

`capacityTrend` (`DashboardSummary`) : même formule que la capacité
mono-mois (`capacity`), répétée sur chaque mois de `chartHorizon` (18 mois
glissants), pas sur tout `dataHorizon` — c'est un nouveau besoin multi-mois,
volontairement borné à la fenêtre affichée plutôt qu'un retour à l'ancien
calcul pré-`cycleReferenceMonth` sur l'horizon complet des données (voir la
note sur la simplification dans la section précédente).

**Performance vérifiée avant livraison** (comme demandé) : 468 points (26
machines × 18 mois, jeu de test réel), calcul isolé ~20 ms, requête API
complète bout en bout ~25 ms sur les appels suivant l'échauffement JIT.
Négligeable pour un usage interactif — aucune optimisation nécessaire (pas de
batching des requêtes SQL par mois, la boucle naïve sur `capacityForMonth`
suffit).

**Tri des machines dans la heatmap** : par pic d'utilisation décroissant sur
`chartHorizon`, pas par famille de process puis nom. Choix motivé par
l'objectif explicite de la vue — repérer les goulots, y compris ceux qui se
déplacent dans le temps — donc mettre les machines les plus contraintes en
haut de la grille sert directement cet objectif, alors qu'un tri alphabétique
par famille sert plutôt un usage "je cherche telle machine précise". À
reconsidérer si l'usage réel montre que le regroupement par famille de
process est plus utile en pratique.

## Recalcul

Tous les indicateurs sont recalculés à la volée à chaque requête (pas de table
de résultats pré-agrégés) — le volume du jeu de test (~3 300 lignes au total)
rend ce recalcul quasi instantané. Pas de bouton "recalculer" manuel nécessaire.

## Propositions de réconciliation (LLM)

Principe non négociable : **le LLM synthétise, il n'invente pas les chiffres**.
Tout le contexte numérique fourni au LLM est calculé par l'application
(`server/src/calc/reconciliation.ts`, fonction `buildReconciliationContext`) ;
le LLM interprète et rédige, il ne calcule jamais un résultat lui-même — les
gaps résultants après application d'une option sont recalculés
déterministiquement par l'application (`server/src/calc/reconciliationRecalc.ts`).

**Périmètre du contexte** : toujours limité aux mois de `chartHorizon`
strictement postérieurs à `frozenPeriodEndMonth` (`unfrozenMonths`) — la
période gelée reste intouchable, y compris dans les propositions.

- **Gaps de capacité** : réutilise `capacityTrend` déjà calculé (aucune requête
  SQL supplémentaire), filtré aux mois non gelés, avec `is_gap` = utilisation
  au-delà de `capacity_utilization_gap_pct`.
- **Tendance d'utilisation par ligne** (`lineUtilizationTrend`) : agrège
  `capacityTrend` par (site, ligne) sur tout `chartHorizon` (pas seulement les
  mois non gelés, pour juger un motif chronique sur la durée). Une ligne est
  qualifiée `surcharge_chronique` / `sous_utilisation_chronique` si au moins
  70 % de ses mois dépassent le seuil haut / passent sous un seuil bas fixe de
  50 % (`CHRONIC_MONTH_RATIO`, `LOW_UTILIZATION_THRESHOLD_PCT` — constantes
  documentées dans le code, pas encore exposées comme seuils configurables).
- **Choc de demande** (`demandShock`) : pour chaque mois non gelé, compare la
  demande consolidée réelle à une baseline = moyenne des 6 mois précédents
  (`BASELINE_WINDOW_MONTHS`, y compris des mois antérieurs à `chartHorizon` si
  besoin). Écart ≥ seuil `demand_shock_threshold_pct` (table
  `alert_thresholds`, défaut 20 %) = choc détecté. Moins de 2 mois d'historique
  disponible = pas de baseline calculable, `is_shock` reste `false` plutôt que
  d'extrapoler.
- **Coûts produits** (`relevantProductCosts`) : uniquement les produits
  réellement planifiés (table `production_orders`) sur une machine/mois en gap
  — pas le catalogue `01_products` entier, pour éviter de noyer le LLM dans du
  contexte non pertinent.

**Recalcul déterministe des gaps résultants** (jamais par le LLM — le LLM ne
désigne que QUOI faire via le champ `actions` : machine, mois, ligne) :

- *Lissage temporel* : l'excès du mois source (heures planifiées au-delà du
  seuil d'alerte) est déplacé vers le mois cible, borné par la capacité
  disponible restante à ce mois cible sur la même machine. Si la capacité
  cible est insuffisante, l'excès résiduel est signalé explicitement plutôt
  que masqué.
- *Ouverture de ligne* : hypothèse actée avec l'utilisateur (2026-08-21) — la
  nouvelle ligne **duplique à l'identique** les machines et capacités de la
  ligne de référence désignée (pas de montée en puissance, pas de coût
  d'investissement modélisé, car ces données n'existent pas dans le jeu de
  données — le LLM est instruit de signaler cette limite dans
  `missing_data_warning` si pertinent).
- *Fermeture de ligne* : la ligne source est fermée (utilisation ramenée à 0 %)
  et ses heures planifiées sont absorbées intégralement par la ligne cible
  désignée par le LLM, dont la capacité ne change pas — peut donc révéler un
  nouveau gap sur la ligne cible, ce qui est le résultat recherché (visibilité
  sur le risque de consolidation, pas une garantie de faisabilité).

**Schéma de sortie structurée contraint par le contexte** : les identifiants
que le LLM désigne (mois, `machine_id`, ligne, site) ne sont pas de simples
chaînes libres — le schéma Zod est reconstruit à chaque appel
(`buildResponseSchema` dans `reconciliationClient.ts`) avec des `z.enum()`
limités aux valeurs effectivement présentes dans le contexte envoyé. Une
reformulation ou une casse différente est donc rejetée par la validation
structurée elle-même (réponse invalide → `invalid_response`), plutôt que de
provoquer un recalcul silencieusement vide côté `computeResultingGaps`.

**Prompt système** : documenté et versionné dans
`server/src/llm/reconciliationPrompt.ts` (`RECONCILIATION_SYSTEM_PROMPT`),
pour rester modifiable sans toucher au code applicatif.

**Cache par cycle** : une génération par (`cycleReferenceMonth`, `site`),
table `reconciliation_proposals`. `GET /api/reconciliation` ne lit que le
cache (jamais d'appel LLM) ; seul `POST /api/reconciliation/generate` appelle
l'API et écrase le cache existant pour ce cycle/site — c'est le seul point
d'entrée qui facture un appel, déclenché uniquement par le bouton explicite
côté client (à construire à l'étape 2).

**Modèle** : configurable via `SOP_LLM_MODEL` (défaut `claude-sonnet-5`), clé
`ANTHROPIC_API_KEY` chargée depuis `server/.env` (jamais commité — voir
`server/.env.example`). Toute erreur (clé absente, timeout, erreur API,
réponse structurée invalide) revient comme un résultat typé explicite
(`GenerationOutcome`) plutôt que d'échouer silencieusement.
