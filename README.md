# Outil S&OP — Pharma/Chimie

Application web locale de Sales & Operations Planning (S&OP) pour une
activité pharma/chimie multi-sites : ingestion flexible de données de
planification, moteur de calcul (demande consolidée, utilisation capacité,
gaps, disponibilité RH), tableau de bord live en mode présentation, et
export PPTX à la demande.

## Prérequis

- **Node.js ≥ 22.5** (le stockage utilise `node:sqlite`, le module SQLite
  intégré à Node — voir [Décisions techniques](#décisions-techniques)).
  Développé et testé avec Node v26.3.1.

## Installation

```bash
cd server && npm install
cd ../client && npm install
```

## Lancement

Deux serveurs de dev, chacun dans son propre terminal :

```bash
# Terminal 1 — API + moteur de calcul (port 4000)
cd server && npm run dev

# Terminal 2 — interface web (port 5173, proxy /api vers le port 4000)
cd client && npm run dev
```

Ouvrir **http://localhost:5173** :
- `/` — mode présentation (plein écran, navigation clavier ← →)
- `/admin` — mode admin (import & mapping, sources connectées, seuils d'alerte)

La base SQLite (`server/data/sop.db`) est créée automatiquement au premier
lancement, avec son schéma.

### Charger les données de test

```bash
cd server
npm run ingest:test       # importe les 8 CSV du dossier de données de test
npm run ingest:renamed    # variante : mêmes données, colonnes renommées (test du mapping flexible)
```

Alternative : déposer un fichier dans `server/data/watched/<entité>/`
(`products`, `machines`, `employees`, `forecasts`, `production_orders`,
`maintenance_plans`, `shutdowns`, `absences`) — il est importé automatiquement,
sans redémarrer le serveur.

## Tests

```bash
cd server && npm test
```

Couvre : le garde-fou de confiance du mapping (bloque l'import d'une
signature jamais vue sous le seuil), la régression du bug d'inversion
`dosage_form`/`strength`, l'aperçu `dryRun` sans écriture en base, le mapping
fuzzy sur des colonnes renommées, et l'ingestion XLSX.

## Structure du repo

```
server/           API Express + TypeScript
  src/db/         schéma SQLite (node:sqlite) + connexion
  src/ingestion/  parsers CSV/XLSX/JSON, mapping fuzzy, validation
  src/calc/       moteur de calcul S&OP
  src/routes/     API REST + SSE (/api/events)
  src/export/     génération PPTX (pptxgenjs)
  fixtures/       CSV de test (originaux renommés + cas de régression)
client/           React 19 + Vite + TypeScript + Tailwind
  src/presentation/  mode présentation (3 vues + navigation)
  src/admin/         mode admin (3 écrans)
  src/api/           client HTTP + hook de live-refresh (SSE)
docs/             schéma de données, formules de calcul, écarts maquette/impl.
design/           maquettes Claude Design de référence
```

## Fonctionnalités

**Ingestion** — CSV, XLSX, JSON. Mapping colonne source → champ cible proposé
automatiquement (similarité de nom + type inféré sur un échantillon de
valeurs), mémorisé par signature d'en-têtes pour les imports suivants.
Validation ligne à ligne (type, champs requis, clés étrangères) : une ligne
invalide part en quarantaine, elle n'annule pas le reste de l'import. Une
signature d'en-têtes **jamais vue**, avec une colonne sous le seuil de
confiance, bloque l'écriture en base et attend une confirmation explicite
(mode admin, écran "Import & mapping").

**Mode présentation** — synthèse exécutive (scorecard), revue de la demande
(tendance + répartition par famille), revue de la capacité (utilisation par
machine). Navigation entre cycles (mois de référence, par défaut le mois
calendaire actuel, navigable vers tout mois avec des données), horizon des
graphiques roulant sur 18 mois à partir du cycle consulté, période gelée
configurable marquée visuellement sur le graphique de demande, filtre par
site, mise à jour live sans reload (SSE).

**Mode admin** — Import & mapping (avec confirmation manuelle si besoin),
Sources connectées (état par entité, historique des échecs, relance),
Seuils d'alerte (édition en direct, avec aperçu de l'impact recalculé).

**Export PPTX** — instantané du cycle consulté (synthèse, demande, capacité),
depuis le mode présentation ou un raccourci "aujourd'hui" en mode admin.

## Hypothèses de calcul

Toutes les formules (capacité disponible, utilisation, détection de gap,
demande consolidée, disponibilité RH, résolution du mois de référence,
période gelée) sont documentées avec leurs hypothèses dans
**[`docs/calculations.md`](docs/calculations.md)** — à consulter avant
d'auditer ou de faire évoluer un calcul.

Le schéma de données cible (entités, clés de jointure, tables d'outillage)
est documenté dans **[`docs/data-model.md`](docs/data-model.md)**.

## Limites connues (V1)

- **Pas de charge RH réelle** — seule la disponibilité (FTE − absences) est
  calculée ; aucune donnée ne lie un employé à un ordre de fabrication précis.
- **Réconciliation, impact financier et décisions curatées** (options
  chiffrées, arbitrages, notes finance) ne sont pas dans ce lot — la maquette
  de référence les présente, mais ce sont des contenus saisis par un humain,
  pas calculables depuis les données. Voir
  [`docs/design-gaps.md`](docs/design-gaps.md).
- **Pas d'archivage figé par cycle** — naviguer vers un cycle passé recalcule
  les données *actuelles* à travers le prisme de ce mois ; ce n'est pas un
  instantané de ce qui était affiché à l'époque. Si les données sources ont
  été réimportées depuis, la vue reflète leur état présent. Détaillé dans
  `docs/calculations.md`.
- **Pas de contrôle par nomenclature ni de détection de doublon de clé
  primaire** à l'ingestion (un doublon écrase silencieusement via
  `INSERT OR REPLACE`). Voir `docs/design-gaps.md`.
- Trois KPI du scorecard exécutif (taux de service, écart demande vs plan,
  couverture de stock) affichent "donnée non disponible" — aucune donnée
  source ne les permet actuellement.

## Décisions techniques

- **`node:sqlite` plutôt que `better-sqlite3`** — la compilation native de
  `better-sqlite3` échoue sur les versions récentes de Node (API V8 changée).
  `node:sqlite`, intégré à Node ≥ 22.5, couvre les mêmes besoins sans
  dépendance native à compiler.
- **Server-Sent Events plutôt que WebSocket** pour le live-refresh — besoin
  unidirectionnel (serveur → client), SSE suffit sans la complexité d'un
  WebSocket.
- **Vulnérabilités npm connues, non corrigées** : `xlsx` (prototype
  pollution/ReDoS) et `image-size` via `pptxgenjs` (DoS sur fichiers
  image malveillants). Risque jugé nul dans ce contexte : outil local
  mono-utilisateur, aucun fichier externe non fiable n'est analysé par ces
  chemins de code.

Détails complets de ces décisions et des compromis pris en cours de route
dans `docs/data-model.md` et `docs/design-gaps.md`.
