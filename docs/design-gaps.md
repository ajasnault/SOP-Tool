# Écarts maquette ↔ implémentation

Les deux maquettes Claude Design (`design/S&OP Mode Présentation.html`,
`design/S&OP Mode Admin.html`) contiennent des éléments qui vont au-delà de ce
qui est calculable avec les données/backend actuels. Décisions actées avec
l'utilisateur (2026-08-20) plutôt que d'improviser silencieusement :

## 1. Vues "Réconciliation" et "Décisions" (mode présentation)

La maquette présente 5 vues entièrement remplies, dont réconciliation (options
A/B/C chiffrées) et décisions (owner/échéance/statut). Ce contenu est
**curated** (saisi par un humain), pas calculé — cf. décision V1 déjà actée
dans le plan (`~/.claude/plans/cryptic-tumbling-bubble.md`) de reporter ces
sections à une itération suivante.

**Décision** : l'implémentation réelle (étape 4) ne construit que les 3
premières vues (synthèse exécutive, revue demande, revue capacité), fidèles à
la maquette et branchées sur les vraies données. Réconciliation et décisions
arriveront avec leur propre écran de saisie admin, en V2.

**Mise à jour (2026-08-23)** : ces deux vues sont maintenant implémentées, mais
pas comme du contenu curated saisi en admin — la réconciliation est générée
par LLM à partir du contexte chiffré déjà calculé (jamais de chiffre inventé,
voir docs/calculations.md), et les décisions sont une table CRUD humaine
classique (pas d'écran admin séparé, la saisie se fait directement dans la vue
présentation). Voir docs/calculations.md ("Propositions de réconciliation
(LLM)") et docs/data-model.md (table `decisions`).

## 2. Contrôles de validation supplémentaires (mode admin)

La maquette admin montre trois contrôles ; état après construction de l'écran
"Sources connectées" (2026-08-20) :

- **État "échec de parsing" avec bouton Relancer, et fraîcheur de source** —
  **fait**. `import_batches` a maintenant `status`/`error_message`
  (migration additive dans `db/connection.ts`) ; toute erreur d'import (route
  HTTP ou watcher) est tracée via `recordFailedImport()`. "Relancer"
  (`POST /api/sources/:entity/retry`) ne fonctionne que si le fichier de la
  tentative précédente existe encore sur disque — vrai pour les imports
  déclenchés par le dossier watché (`data/watched/<entity>/`), **pas** pour un
  upload via Import & mapping (le fichier temporaire est supprimé après
  chaque requête) : dans ce cas l'API renvoie une erreur explicite plutôt que
  d'échouer silencieusement. Fraîcheur affichée à partir de l'horodatage réel
  du dernier import, seuil d'alerte configurable (`source_staleness_warning_hours`,
  défaut 24h, même mécanisme générique que les autres seuils).
- **Valeur hors référentiel** (validation par nomenclature) et **doublon de
  clé primaire signalé en quarantaine** — toujours non implémentés.
  `validate.ts` ne fait que type/requis/FK ; un doublon de clé primaire est
  toujours silencieusement écrasé par `INSERT OR REPLACE`. Documentés comme
  écart connu, à ajouter si besoin.

**Bug réel trouvé en construisant cet écran** : `XLSX.readFile` (import XLSX)
ne fonctionnait pas du tout — l'interop ESM/CJS du paquet `xlsx` place son
export réel sous `XLSX.default` selon l'environnement, `XLSX.readFile` étant
`undefined` sur l'export nommé. Un import XLSX échouait donc systématiquement
(masqué jusqu'ici car jamais testé avec un vrai fichier XLSX, seulement CSV).
Corrigé en lisant le fichier en buffer et en utilisant `XLSX.read()` (toujours
présent sur l'export nommé) plutôt que `XLSX.readFile()`. Test de régression :
`server/src/ingestion/xlsxParsing.test.ts`.

## 3. Seuils supplémentaires non calculables (écran "Seuils d'alerte")

La maquette liste 4 seuils que les données actuelles ne permettent pas de
calculer :
- `service_level_target_pct` (taux de service) — **branché le 2026-10-07**
  sur le taux de service prévisionnel (défaut 95 %), exposé dans "Seuils
  d'alerte".
- `stock_coverage_min_weeks` (couverture de stock) — nécessite des données de
  stock/inventaire, absentes.
- `absence_rate_max_pct` — calculable en théorie (les absences existent),
  mais pas encore branché comme seuil d'alerte distinct.
- `forecast_mape_max_pct` (précision du forecast) — nécessite un historique
  prévision vs réel (ventes réelles), absent du jeu de test (`03_forecasts.csv`
  ne contient que du prévisionnel, pas de réel a posteriori).

**Décision** : l'écran "Seuils d'alerte" (étape 5) n'expose que les seuils
réellement branchés à un calcul (`capacity_utilization_gap_pct`,
`mapping_confidence_min`). Les autres ne sont pas affichés tant que les
données/calculs correspondants n'existent pas — pas de seuil "fantôme"
grisé qui laisserait croire à une fonctionnalité existante.

## 4. Différences de schéma (mode admin, écran mapping)

La maquette utilise des noms de champs cibles (`product_family`, `unit`,
`is_active` booléen) qui ne correspondent pas exactement au schéma réel
(`family`, `unit_of_measure`, pas de champ booléen dans `targetSchema.ts`).
Traité comme un exemple illustratif de la maquette plutôt qu'une spec exacte —
l'écran réel (étape 5) affichera les vrais champs cibles de
`server/src/ingestion/targetSchema.ts`, pas ceux de la maquette telle quelle.

## 5bis. Trois KPI du scorecard exécutif non calculables

En construisant la vue 1, la maquette compte 6 statistiques dont 3 supposent
des données absentes du jeu de données (même famille de problème que le
point 3, appliquée cette fois aux KPI individuels plutôt qu'à des vues
entières — même politique appliquée, pas de nouvelle décision) :
- **Taux de service prévisionnel** — nécessite des données de
  livraison/exécution des commandes. **Mise à jour (2026-10-07)** : calculé
  désormais en version *prévisionnelle* (demande couverte par le plan de
  production, plafonnée par produit), sans nouvelle donnée — voir
  docs/calculations.md ("Taux de service prévisionnel"). Le taux de service
  *réalisé* reste non calculable sans données de livraison.
- **Écart demande vs plan (vs cycle précédent)** — nécessite un instantané du
  cycle précédent à comparer ; aucun mécanisme de versionnement de cycle
  n'existe dans le modèle de données actuel.
- **Couverture de stock** — nécessite des données de stock/inventaire.

**Décision** : ces 3 cartes affichent un état "donnée non disponible" (tiret
+ légende discrète) plutôt qu'une valeur fabriquée, en conservant le même
gabarit de carte que les KPI réels pour ne pas casser la grille visuelle.
Les 3 KPI réellement calculés (utilisation moyenne capacité, machines en
dépassement de seuil, disponibilité RH) sont scopés au **mois courant**
(`currentMonth` — le mois calendaire en cours s'il est dans l'horizon des
données importées, sinon le premier mois de l'horizon), pas à une moyenne sur
les 18 mois d'horizon : un scorecard exécutif lit "l'état actuel du plan", pas
une moyenne glissante, et mélanger les deux échelles (moyenne horizon pour
l'un, instantané pour l'autre) aurait été incohérent.

## 5. Filtre par site — ajouté au backend (pas un écart, une extension)

Le filtre "Consolidé / Lyon / Cork / Puurs" de la maquette n'était pas
supporté par l'API (`computeDashboard` ne prenait pas de paramètre site).
Ajouté proprement plutôt que contourné côté client : `GET /api/dashboard?site=...`
et `GET /api/sites` (liste dynamique des sites vus dans les données, pas codée
en dur). Voir `server/src/calc/{capacity,demand,hr}.ts` et
`server/src/routes/dashboard.ts`.

## 6. Export PPTX déplacé dans le mode présentation (2026-08-20)

Le plan initial prévoyait le bouton d'export uniquement en mode admin. En
branchant l'export sur `cycleReferenceMonth` (étape 3/3 de la navigation
entre cycles), un problème d'architecture est apparu : le mode admin n'a
aucune notion du cycle consulté — c'est un état propre au mode présentation
(`PresentationApp`), sur une route différente. Un bouton d'export en admin
ne pourrait exporter que "aujourd'hui", jamais "le cycle que je suis en
train de regarder" — ce que demande explicitement le besoin ("exporter
l'instantané d'un cycle précis qu'on est en train de consulter").

**Décision** : lien d'export ajouté dans le pied de page du mode présentation
lui-même (`SlideFooter`), construit sur `data.cycleReferenceMonth` (la valeur
résolue côté serveur pour ce qui est réellement affiché, pas l'état local qui
peut valoir "non défini = aujourd'hui" et dériver d'ici le clic). Le lien
existant en mode admin (`AdminLayout`) est conservé tel quel — il exporte
toujours "aujourd'hui, consolidé", ce qui reste un raccourci valide, juste
moins riche que celui du mode présentation. Pas de sélecteur de cycle ajouté
côté admin : ça aurait dupliqué `CycleNav` pour un besoin déjà couvert.
