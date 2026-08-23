# Modèle de données cible

Schéma normalisé vers lequel toute source importée (CSV/XLSX/JSON, quels que soient
ses noms de colonnes) est mappée. Définition SQL : `server/src/db/schema.sql`.
Définition des champs + synonymes utilisés par le mapping flexible :
`server/src/ingestion/targetSchema.ts` (source de vérité — ce document en est la
version lisible).

## Entités métier

| Table | Clé | Références | Origine typique (jeu de test) |
|---|---|---|---|
| `products` | `product_id` | — | `01_products.csv` |
| `machines` | `machine_id` | — | `02_machines.csv` |
| `employees` | `employee_id` | — | `07_hr_resources.csv` |
| `forecasts` | `id` (auto) | `product_id → products` | `03_forecasts.csv` |
| `production_orders` | `order_id` | `product_id → products`, `machine_id → machines` | `04_production_plan.csv` |
| `maintenance_plans` | `maintenance_id` | `machine_id → machines` | `05_maintenance_plan.csv` |
| `shutdowns` | `shutdown_id` | — (`site`/`production_line` en texte libre, pas de table `sites`) | `06_shutdowns.csv` |
| `absences` | `absence_id` | `employee_id → employees` | `08_hr_absences.csv` |

`products`, `machines` et `employees` n'ont pas de dépendances — ils doivent être
importés avant les entités qui les référencent (`forecasts`/`production_orders`
avant `products`+`machines` ; `absences` avant `employees`). L'ingestion valide les
FK par une requête applicative avant insertion (pas uniquement `PRAGMA foreign_keys`)
pour pouvoir mettre en quarantaine une ligne invalide sans annuler tout l'import.

Dates/mois stockés en TEXT ISO (`YYYY-MM-DD`, `YYYY-MM-DD HH:MM` ou `YYYY-MM` pour
`forecasts.month`) — pas de type DATE natif en SQLite.

## Tables outillage (ingestion, config)

- **`mapping_configs`** — mapping colonne source → champ cible validé, indexé par
  `(entity, source_signature)` où `source_signature` est un hash des en-têtes
  source triés. Un import suivant avec exactement les mêmes en-têtes réutilise ce
  mapping sans repasser par la confirmation manuelle.
- **`import_batches`** / **`import_errors`** — un batch par import, avec le compte
  de lignes importées/quarantainées ; le détail ligne par ligne des erreurs
  (champ, message, ligne brute en JSON) pour affichage dans le rapport de
  validation.
- **`alert_thresholds`** — seuils configurables (ex. `capacity_utilization_gap_pct`,
  défaut 90).
- **`reconciliation_proposals`** — cache des propositions générées par LLM, une
  par (`cycle_reference_month`, `site`) ; voir docs/calculations.md,
  "Propositions de réconciliation (LLM)".
- **`decisions`** — plan d'action (vue "Décisions", mode présentation) :
  description, responsable, échéance, statut (`a_faire`/`en_cours`/`fait`/
  `abandonne`). Saisie humaine uniquement, aucun LLM impliqué. `source_option_title`
  trace, à titre indicatif seulement (pas une clé étrangère), qu'une décision a
  été pré-remplie depuis une option de réconciliation — reste valide même si
  cette proposition a depuis été écrasée par une régénération.

## Hypothèses de calcul

Voir `docs/calculations.md` pour les formules exactes (capacité disponible,
utilisation, gaps, demande consolidée, disponibilité RH).

## Décisions techniques prises pendant l'implémentation (non prévues au plan initial)

- **Stockage : `node:sqlite` (module natif de Node) plutôt que `better-sqlite3`.**
  Le plan initial prévoyait `better-sqlite3`, mais sa compilation native (node-gyp)
  échoue sur la version de Node de cette machine (v26.3.1, très récente — API V8
  changée). `node:sqlite` est intégré à Node depuis la 22.5, sans dépendance
  native à compiler, et couvre les mêmes besoins (requêtes préparées, synchrone).
  **Risque à surveiller** : API plus jeune/étroite que `better-sqlite3`, et
  nécessite Node ≥ 22.5 — si ce projet tourne un jour sur une machine avec un
  Node plus ancien, il faudra soit upgrader Node, soit revenir à
  `better-sqlite3` (le code d'accès DB est isolé dans `server/src/db/connection.ts`,
  donc le changement serait localisé).
- **Vulnérabilité connue non corrigée : `xlsx` (SheetJS).** `npm audit` remonte une
  vulnérabilité high (prototype pollution + ReDoS, sans fix publié sur le
  registre npm). Risque jugé acceptable ici : outil local mono-utilisateur,
  fichiers importés = les siens, `wms-claude-code` dépend déjà du même paquet.
  À documenter dans le README (étape 10 du plan) et à re-vérifier si l'outil est
  un jour exposé à des fichiers non fiables.

## Garde-fou de confiance du mapping

Suite à un incident réel (deux colonnes d'un fichier produits, `Présentation`
et `dosage`, mappées à l'envers sur `dosage_form`/`strength` — le nom de
colonne `dosage` accrochait sur le champ `dosage_form` malgré un contenu
("100mg") qui correspondait en réalité à `strength`) :

1. **Fix du matcher** (`server/src/ingestion/fuzzyMap.ts`) : ajout d'un type
   `measurement` (nombre + unité, ex. "100mg") distinct de `text`, vote
   majoritaire (au lieu d'unanimité stricte) pour l'inférence de type afin de
   tolérer les placeholders ("-", "n/a"...), poids du score de type renforcé
   (0.45 contre 0.3 avant), et pénalité explicite quand un nom ne l'emporte
   que par inclusion littérale alors que le contenu réel contredit le type
   attendu.
2. **Garde-fou structurel** : pour toute signature d'en-têtes **jamais vue**
   (absente de `mapping_configs`), si une colonne mappée a un score de
   confiance sous `mapping_confidence_min` (config générique via
   `alert_thresholds`, défaut **0.75**), rien n'est écrit en base — l'import
   renvoie `status: "pending_confirmation"` avec le mapping proposé et les
   champs en cause. Une signature déjà connue (ou un mapping explicitement
   fourni) s'applique toujours automatiquement, sans redemander.

**Confirmation concrète (pas d'UI dédiée à ce stade)** : deux appels HTTP.

```bash
# 1) Tentative d'import — si une signature jamais vue a des colonnes sous le
#    seuil, réponse HTTP 202 avec le mapping proposé, rien n'est importé :
curl -X POST http://localhost:4000/api/import/products -F "file=@mon_fichier.csv"

# 2) Confirmation (mapping proposé accepté tel quel, ou corrigé à la main) :
curl -X POST http://localhost:4000/api/import/products/confirm \
  -F "file=@mon_fichier.csv" \
  -F 'mapping={"product_id":"...", "product_name":"...", ...}'
# -> mémorise le mapping pour cette signature et importe. Les imports
#    suivants du même type de fichier n'auto-appliquent qu'après cette
#    confirmation initiale.
```

Le seuil est ajustable comme les autres seuils (`GET/PUT /api/thresholds/mapping_confidence_min`).

- **Typage `pptxgenjs` cassé sous `NodeNext`** — même famille de problème que
  `xlsx` (interop ESM/CJS), mais spécifique au typage : la fusion
  classe+namespace de ses `.d.ts` ne se résout pas sous
  `"moduleResolution": "NodeNext"` (`new PptxGenJS()` non constructible côté
  TypeScript). Le runtime fonctionne (vérifié par un test direct avant de
  construire dessus). Contourné en typant `server/src/export/pptx.ts` en
  `any` localement, avec commentaire explicatif — pas de `@ts-ignore` global.
- **Vulnérabilité connue non corrigée : `image-size`** (dépendance de
  `pptxgenjs`) — DoS par boucle infinie sur des fichiers ICNS/JXL/HEIF
  malveillants. Même raisonnement que pour `xlsx` : l'export PPTX n'analyse
  aucune image externe, seulement les graphiques que l'outil génère
  lui-même — risque jugé nul dans ce contexte.

## Limite connue (V1)

Aucune donnée source ne lie un employé à un ordre de fabrication précis — la vue RH
expose donc la **disponibilité** (FTE − absences) par équipe/rôle/site, pas une
charge réelle comparée à cette disponibilité. Ajouter cette vue nécessiterait une
donnée d'affectation qui n'existe pas dans le jeu de test actuel.
