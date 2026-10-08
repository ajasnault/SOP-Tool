/**
 * Générateur du jeu de données "flux + contrôle qualité" (voir docs/data-model.md,
 * "Gammes, lots et contrôle qualité").
 *
 * Reprend tels quels le référentiel produits, la demande et les données RH d'un
 * jeu existant, et REGÉNÈRE tout ce qui dépend du process :
 * - parc machines organisé en lignes cohérentes par site ;
 * - gammes (routings) : ordre des opérations par forme galénique, points QC ;
 * - plan de production : un OF = une opération d'un lot sur une machine, les lots
 *   suivent leur gamme dans l'ordre, ordonnancement à capacité finie ;
 * - résultats QC : délai de libération ~ N(μ, σ), mesure ~ N(μ_produit, σ_produit)
 *   comparée à la spec. Un lot hors spécifications s'arrête là (aucun OF aval) ;
 * - maintenance et arrêts programmés alignés sur les nouvelles lignes.
 *
 * Avant la date d'extraction (--asof), tout est "réalisé" (résultats QC connus,
 * rejets effectifs). Après, le plan suppose la conformité mais lance plus de lots
 * pour compenser le rendement QC attendu (calculé à partir des distributions).
 *
 * Usage : tsx src/scripts/generateFlowDataset.ts --out=<dossier> [--products=…]
 *         [--forecasts=…] [--employees=…] [--absences=…] [--asof=2026-10-08] [--seed=42]
 */
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import Papa from "papaparse";

// ---------------------------------------------------------------------------
// Arguments

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=")];
    })
);
const DATA_ROOT = path.join(process.env.HOME ?? "", "Documents", "Projet S&OP", "Téléchargements");
const PRODUCTS_FILE = args.products || path.join(DATA_ROOT, "jeu_stress_test", "01_products.csv");
const FORECASTS_FILE = args.forecasts || path.join(DATA_ROOT, "03_forecasts (1).csv");
const EMPLOYEES_FILE = args.employees || path.join(DATA_ROOT, "jeu_stress_test", "07_hr_resources.csv");
const ABSENCES_FILE = args.absences || path.join(DATA_ROOT, "jeu_stress_test", "08_hr_absences.csv");
const OUT_DIR = args.out;
if (!OUT_DIR) {
  console.error("--out=<dossier> requis");
  process.exit(1);
}
const ASOF = new Date(`${args.asof || "2026-10-08"}T00:00:00Z`).getTime();
const SEED = Number(args.seed || 42);

// ---------------------------------------------------------------------------
// Aléa reproductible

let rngState = SEED >>> 0;
function rand(): number {
  // mulberry32
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function uniform(a: number, b: number): number {
  return a + (b - a) * rand();
}
function normal(mean: number, sd: number): number {
  const u = 1 - rand();
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}
/** Fonction de répartition de la loi normale centrée réduite (Abramowitz-Stegun 7.1.26). */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf =
    1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

// ---------------------------------------------------------------------------
// Gammes types

interface QcSpec {
  point: string;
  attribute: string;
  low: number;
  high: number;
  leadMean: number;
  leadSd: number;
}
interface StepTemplate {
  operation: string;
  machineType: string;
  qc?: QcSpec;
}

const QC_VRAC: QcSpec = {
  point: "Contrôle en cours (vrac)",
  attribute: "Teneur en principe actif (% théorique)",
  low: 95,
  high: 105,
  leadMean: 24,
  leadSd: 6,
};
const QC_API: QcSpec = { point: "Libération API", attribute: "Titre (% sur substance sèche)", low: 98, high: 102, leadMean: 120, leadSd: 24 };
const QC_PF: QcSpec = {
  point: "Libération produit fini",
  attribute: "Dosage (% de la teneur déclarée)",
  low: 95,
  high: 105,
  leadMean: 168,
  leadSd: 36,
};
// Le test de stérilité (14 jours d'incubation) domine le délai de libération des injectables.
const QC_PF_STERILE: QcSpec = { ...QC_PF, leadMean: 336, leadSd: 48 };
const QC_PF_COND: QcSpec = {
  point: "Libération produit fini",
  attribute: "Masse nette moyenne (% nominale)",
  low: 97,
  high: 103,
  leadMean: 48,
  leadSd: 12,
};

function routingTemplate(family: string, dosageForm: string): StepTemplate[] {
  switch (family) {
    case "API":
      return [
        { operation: "Synthèse", machineType: "Réacteur" },
        { operation: "Centrifugation", machineType: "Centrifugeuse" },
        { operation: "Séchage", machineType: "Sécheur", qc: QC_API },
      ];
    case "Formulation Solide":
      return dosageForm === "Gélule"
        ? [
            { operation: "Granulation", machineType: "Granulateur", qc: QC_VRAC },
            { operation: "Remplissage gélules", machineType: "Géluleuse" },
            { operation: "Mise sous blister", machineType: "Ligne blister" },
            { operation: "Encartonnage", machineType: "Encartonneuse", qc: QC_PF },
          ]
        : [
            { operation: "Granulation", machineType: "Granulateur", qc: QC_VRAC },
            { operation: "Compression", machineType: "Presse à comprimés" },
            { operation: "Pelliculage", machineType: "Enrobeuse" },
            { operation: "Mise sous blister", machineType: "Ligne blister" },
            { operation: "Encartonnage", machineType: "Encartonneuse", qc: QC_PF },
          ];
    case "Formulation Liquide":
      return [
        { operation: "Mélange", machineType: "Cuve de mélange", qc: QC_VRAC },
        { operation: "Remplissage flacons", machineType: "Ligne remplissage liquide" },
        { operation: "Étiquetage", machineType: "Étiqueteuse" },
        { operation: "Encartonnage", machineType: "Encartonneuse", qc: QC_PF },
      ];
    case "Formulation Injectable":
      return [
        { operation: "Formulation stérile", machineType: "Cuve de formulation stérile", qc: QC_VRAC },
        { operation: "Remplissage aseptique", machineType: "Ligne remplissage stérile" },
        { operation: "Inspection visuelle", machineType: "Mireuse automatique" },
        { operation: "Encartonnage", machineType: "Encartonneuse", qc: QC_PF_STERILE },
      ];
    case "Packaging":
      // Façonnage : le vrac est reçu déjà libéré, seul le conditionnement est fait sur site.
      if (dosageForm === "Blister")
        return [
          { operation: "Mise sous blister", machineType: "Ligne blister" },
          { operation: "Encartonnage", machineType: "Encartonneuse", qc: QC_PF_COND },
        ];
      if (dosageForm === "Étiquetage")
        return [
          { operation: "Étiquetage", machineType: "Étiqueteuse" },
          { operation: "Encartonnage", machineType: "Encartonneuse", qc: QC_PF_COND },
        ];
      return [{ operation: "Encartonnage", machineType: "Encartonneuse", qc: QC_PF_COND }];
    default:
      throw new Error(`Famille sans gamme type : ${family}`);
  }
}

// Ligne de rattachement, famille process, temps de changement de série (nettoyage
// complet au changement de produit, inclut le vide de ligne) et temps de vide de
// ligne (h). Le vide de ligne est obligatoire entre deux OF, même pour un lot du
// même produit (GMP : retrait des articles, documents et étiquettes du lot
// précédent, vérification avant démarrage).
const MACHINE_TYPES: Record<string, { line: string; processFamily: string; changeover: number; clearance: number }> = {
  Réacteur: { line: "Ligne API", processFamily: "API", changeover: 10, clearance: 2 },
  Centrifugeuse: { line: "Ligne API", processFamily: "API", changeover: 4, clearance: 1 },
  Sécheur: { line: "Ligne API", processFamily: "API", changeover: 6, clearance: 1 },
  Granulateur: { line: "Ligne Solides", processFamily: "Formulation Solide", changeover: 4, clearance: 1 },
  "Presse à comprimés": { line: "Ligne Solides", processFamily: "Formulation Solide", changeover: 3, clearance: 1 },
  Géluleuse: { line: "Ligne Solides", processFamily: "Formulation Solide", changeover: 3, clearance: 1 },
  Enrobeuse: { line: "Ligne Solides", processFamily: "Formulation Solide", changeover: 3, clearance: 1 },
  "Cuve de mélange": { line: "Ligne Liquides", processFamily: "Formulation Liquide", changeover: 3, clearance: 1 },
  "Ligne remplissage liquide": { line: "Ligne Liquides", processFamily: "Formulation Liquide", changeover: 2.5, clearance: 1 },
  "Cuve de formulation stérile": { line: "Ligne Stérile", processFamily: "Formulation Injectable", changeover: 6, clearance: 1.5 },
  "Ligne remplissage stérile": { line: "Ligne Stérile", processFamily: "Formulation Injectable", changeover: 8, clearance: 2 },
  "Mireuse automatique": { line: "Ligne Stérile", processFamily: "Formulation Injectable", changeover: 1.5, clearance: 0.5 },
  "Ligne blister": { line: "Ligne Conditionnement", processFamily: "Packaging", changeover: 2, clearance: 1 },
  Étiqueteuse: { line: "Ligne Conditionnement", processFamily: "Packaging", changeover: 1, clearance: 0.5 },
  Encartonneuse: { line: "Ligne Conditionnement", processFamily: "Packaging", changeover: 1, clearance: 0.5 },
};

// Goulot délibéré par site : dimensionné plus serré que le reste du flux.
const DESIGNED_BOTTLENECK: Record<string, string> = {
  "Site A - Lyon": "Ligne remplissage liquide",
  "Site B - Cork": "Réacteur",
  "Site C - Puurs": "Presse à comprimés",
};
// Produits "à problème" (process mal centré au contrôle vrac) : un par site, sur un flux différent.
const PROBLEM_PRODUCT_FAMILY: Record<string, string> = {
  "Site A - Lyon": "Formulation Liquide",
  "Site B - Cork": "Formulation Injectable",
  "Site C - Puurs": "Formulation Solide",
};

// ---------------------------------------------------------------------------
// Lecture des données reprises

function readCsv(file: string): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(readFileSync(file, "utf-8"), { header: true, skipEmptyLines: true });
  return parsed.data;
}

interface Product {
  product_id: string;
  product_name: string;
  family: string;
  dosage_form: string;
  site: string;
  batch: number;
}
const products: Product[] = readCsv(PRODUCTS_FILE).map((r) => ({
  product_id: r.product_id,
  product_name: r.product_name,
  family: r.family,
  dosage_form: r.dosage_form,
  site: r.site,
  batch: Number(r.batch_size_units),
}));

const demandByProductMonth = new Map<string, Map<string, number>>();
for (const r of readCsv(FORECASTS_FILE)) {
  const byMonth = demandByProductMonth.get(r.product_id) ?? new Map<string, number>();
  byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + Number(r.forecast_qty_units));
  demandByProductMonth.set(r.product_id, byMonth);
}
const demandMonths = [...new Set([...demandByProductMonth.values()].flatMap((m) => [...m.keys()]))].sort();
const sites = [...new Set(products.map((p) => p.site))].sort();

// ---------------------------------------------------------------------------
// Gammes par produit + capabilité process (cachée : seule la spec est publiée)

interface RoutingStep extends StepTemplate {
  stepNo: number;
  processMean?: number;
  processSd?: number;
}
const routings = new Map<string, RoutingStep[]>();
const expectedYield = new Map<string, number>();
const problemProducts = new Set<string>();

for (const site of sites) {
  const candidates = products.filter((p) => p.site === site && p.family === PROBLEM_PRODUCT_FAMILY[site]);
  if (candidates.length > 0) problemProducts.add(pick(candidates).product_id);
}

for (const p of products) {
  const steps: RoutingStep[] = routingTemplate(p.family, p.dosage_form).map((t, i) => ({ ...t, stepNo: (i + 1) * 10 }));
  let yieldPct = 1;
  for (const s of steps) {
    if (!s.qc) continue;
    const half = (s.qc.high - s.qc.low) / 2;
    const target = (s.qc.high + s.qc.low) / 2;
    const isProblem = problemProducts.has(p.product_id) && s.qc === QC_VRAC;
    // Cp = demi-tolérance / 3σ. Process "sain" : Cp 0,75–1,3, légèrement décentré
    // (≈ 1–2 % de lots rejetés au global, ordre de grandeur courant en pharma).
    const cp = isProblem ? 0.7 : uniform(0.75, 1.3);
    s.processSd = half / (3 * cp);
    s.processMean = target + (isProblem ? 0.35 * half : normal(0, 0.12 * half));
    const pass = normCdf((s.qc.high - s.processMean) / s.processSd) - normCdf((s.qc.low - s.processMean) / s.processSd);
    yieldPct *= pass;
  }
  routings.set(p.product_id, steps);
  expectedYield.set(p.product_id, yieldPct);
}

// ---------------------------------------------------------------------------
// Parc machines, dimensionné sur la demande "normale" (médiane mensuelle)

interface Machine {
  machine_id: string;
  machine_name: string;
  machine_type: string;
  process_family: string;
  site: string;
  production_line: string;
  capacity: number;
  changeover: number;
  clearance: number;
  oee: number;
  commissioning: number;
  // État de l'ordonnancement
  free: number;
  lastProduct: string | null;
  blocked: [number, number][];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
}

const AVAILABLE_HOURS_PER_MONTH = 715; // ~730 h calendaires moins la maintenance mensuelle moyenne
const machines: Machine[] = [];
const machinesBySiteType = new Map<string, Machine[]>();
// Part maximale du temps cible d'une machine absorbée par les vides de ligne et
// changements de série : au-delà, une machine de plus du même type est installée.
const MAX_OVERHEAD_SHARE = 0.35;
let machineSeq = 0;

for (const site of sites) {
  const city = site.replace(/^Site . - /, "");
  const typesAtSite = new Map<string, { qty: number; products: number; lots: number }>();
  for (const p of products.filter((x) => x.site === site)) {
    const med = median([...(demandByProductMonth.get(p.product_id)?.values() ?? [])]);
    const qty = med / (expectedYield.get(p.product_id) ?? 1);
    for (const s of routings.get(p.product_id)!) {
      const cur = typesAtSite.get(s.machineType) ?? { qty: 0, products: 0, lots: 0 };
      cur.qty += qty;
      cur.products += 1;
      cur.lots += qty / p.batch;
      typesAtSite.set(s.machineType, cur);
    }
  }
  const orderedTypes = Object.keys(MACHINE_TYPES).filter((t) => typesAtSite.has(t));
  for (const type of orderedTypes) {
    const load = typesAtSite.get(type)!;
    const def = MACHINE_TYPES[type];
    const changeover = Math.round(def.changeover * uniform(0.8, 1.2) * 10) / 10;
    const clearance = def.clearance;
    const target =
      DESIGNED_BOTTLENECK[site] === type ? uniform(0.8, 0.84) : type === "Encartonneuse" ? uniform(0.62, 0.68) : uniform(0.4, 0.56);
    // Une campagne par produit et par mois : un changement de série par produit,
    // un vide de ligne pour chacun des autres lots de la campagne.
    const overheadHours = load.products * changeover + Math.max(0, load.lots - load.products) * clearance;
    const targetHours = target * AVAILABLE_HOURS_PER_MONTH;
    const count = Math.max(1, Math.ceil(overheadHours / (MAX_OVERHEAD_SHARE * targetHours)));
    const productionHours = targetHours - overheadHours / count;
    const capacity = Math.max(10, Math.round(load.qty / count / productionHours / 10) * 10);
    const group: Machine[] = [];
    for (let i = 1; i <= count; i++) {
      machineSeq++;
      const m: Machine = {
        machine_id: `MCH-${String(machineSeq).padStart(3, "0")}`,
        machine_name: count > 1 ? `${type} ${i} · ${city}` : `${type} · ${city}`,
        machine_type: type,
        process_family: def.processFamily,
        site,
        production_line: def.line,
        capacity,
        changeover,
        clearance,
        oee: pick([70, 75, 80, 85, 90]),
        commissioning: Math.floor(uniform(2008, 2024)),
        free: 0,
        lastProduct: null,
        blocked: [],
      };
      machines.push(m);
      group.push(m);
    }
    machinesBySiteType.set(`${site}|${type}`, group);
  }
}

// ---------------------------------------------------------------------------
// Arrêts programmés et maintenance (bloquent l'ordonnancement ET la capacité)

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ts = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const linesBySite = new Map<string, string[]>();
for (const m of machines) {
  const lines = linesBySite.get(m.site) ?? [];
  if (!lines.includes(m.production_line)) lines.push(m.production_line);
  linesBySite.set(m.site, lines);
}

interface Shutdown {
  site: string;
  line: string;
  start: string;
  end: string; // exclusif (00:00), même convention que calc/period.ts overlapHours
  reason: string;
}
const shutdowns: Shutdown[] = [];
const lyon = sites.find((s) => s.includes("Lyon"));
const cork = sites.find((s) => s.includes("Cork"));
const puurs = sites.find((s) => s.includes("Puurs"));
if (lyon) {
  for (const line of linesBySite.get(lyon)!) shutdowns.push({ site: lyon, line, start: "2027-07-19", end: "2027-08-09", reason: "Fermeture annuelle été" });
  shutdowns.push({ site: lyon, line: "Ligne Stérile", start: "2026-11-16", end: "2026-11-21", reason: "Requalification GMP (salle propre)" });
}
if (cork) {
  linesBySite.get(cork)!.forEach((line, i) => {
    const start = new Date(ts("2027-06-07") + i * 7 * DAY).toISOString().slice(0, 10);
    const end = new Date(ts("2027-06-07") + (i + 1) * 7 * DAY).toISOString().slice(0, 10);
    shutdowns.push({ site: cork, line, start, end, reason: "Arrêt de ligne tournant (travaux)" });
  });
  shutdowns.push({ site: cork, line: "Ligne API", start: "2027-02-08", end: "2027-02-13", reason: "Requalification GMP" });
}
if (puurs) {
  for (const line of linesBySite.get(puurs)!) shutdowns.push({ site: puurs, line, start: "2026-12-21", end: "2027-01-04", reason: "Congés collectifs" });
  shutdowns.push({ site: puurs, line: "Ligne Liquides", start: "2027-04-12", end: "2027-04-15", reason: "Changement de format" });
}
for (const sd of shutdowns) {
  for (const m of machines.filter((x) => x.site === sd.site && x.production_line === sd.line)) m.blocked.push([ts(sd.start), ts(sd.end)]);
}

interface Maintenance {
  machine_id: string;
  type: string;
  date: string;
  duration: number;
  frequency: string;
}
const maintenances: Maintenance[] = [];
const planningMonths = [prevMonth(demandMonths[0]), ...demandMonths];
for (const m of machines) {
  const requalMonth = pick(planningMonths.slice(2));
  for (const month of planningMonths) {
    const day = String(Math.floor(uniform(2, 27))).padStart(2, "0");
    const isRequal = month === requalMonth;
    const duration = isRequal ? Math.round(uniform(24, 48) * 10) / 10 : Math.round(Math.min(14, Math.max(4, normal(8, 2))) * 10) / 10;
    const date = `${month}-${day}`;
    maintenances.push({
      machine_id: m.machine_id,
      type: isRequal ? "Validation/Requalification" : "Maintenance préventive",
      date,
      duration,
      frequency: isRequal ? "Annuelle" : "Mensuelle",
    });
    const start = ts(date) + 6 * HOUR;
    m.blocked.push([start, start + duration * HOUR]);
  }
  m.blocked.sort((a, b) => a[0] - b[0]);
}

function prevMonth(month: string): string {
  const [y, mo] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return d.toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Lots : une campagne par produit et par mois de demande, surdimensionnée du
// rendement QC attendu ; lancement = date de libération visée − délai standard.

interface Lot {
  lot_id: string;
  product: Product;
  campaign_id: string;
  qty: number;
  release: number;
}
const lots: Lot[] = [];
const TRANSFER_HOURS = 2;
const QUEUE_ALLOWANCE_HOURS = 24;

function standardLeadTimeHours(p: Product): number {
  let h = 0;
  for (const s of routings.get(p.product_id)!) {
    const m = machinesBySiteType.get(`${p.site}|${s.machineType}`)![0];
    h += p.batch / m.capacity + m.changeover + TRANSFER_HOURS + QUEUE_ALLOWANCE_HOURS + (s.qc?.leadMean ?? 0);
  }
  return h;
}

let lotSeq = 0;
for (const p of [...products].sort((a, b) => a.product_id.localeCompare(b.product_id))) {
  const phase = rand(); // position de la campagne dans le mois, propre au produit
  const leadTime = standardLeadTimeHours(p);
  const yieldPct = expectedYield.get(p.product_id) ?? 1;
  let carry = 0;
  for (const month of demandMonths) {
    const demand = demandByProductMonth.get(p.product_id)?.get(month) ?? 0;
    const need = demand / yieldPct + carry;
    const n = Math.max(0, Math.round(need / p.batch));
    carry = need - n * p.batch;
    const targetRelease = ts(`${month}-01`) + (3 + phase * 20) * DAY;
    const campaignId = `CMP-${p.product_id}-${month.replace("-", "")}`;
    for (let i = 0; i < n; i++) {
      lotSeq++;
      lots.push({
        lot_id: `LOT-${String(lotSeq).padStart(6, "0")}`,
        product: p,
        campaign_id: campaignId,
        qty: p.batch,
        release: targetRelease - leadTime * HOUR,
      });
    }
  }
}
lots.sort((a, b) => a.release - b.release || a.product.product_id.localeCompare(b.product.product_id) || a.lot_id.localeCompare(b.lot_id));
// Numérotation chronologique (ordre de lancement), comme dans un vrai MES.
lots.forEach((lot, i) => (lot.lot_id = `LOT-${String(i + 1).padStart(6, "0")}`));

// ---------------------------------------------------------------------------
// Ordonnancement à capacité finie, lot par lot dans l'ordre de lancement

interface Order {
  order_id: string;
  lot_id: string;
  product_id: string;
  step_no: number;
  machine_id: string;
  campaign_id: string;
  start: number;
  end: number;
  qty: number;
  status: string;
  priority: string;
}
interface QcResult {
  qc_id: string;
  lot_id: string;
  product_id: string;
  step_no: number;
  qc_point: string;
  sample: number;
  release: number;
  attribute: string;
  value: number | null;
  low: number;
  high: number;
  result: string;
}
const orders: Order[] = [];
const qcResults: QcResult[] = [];
let orderSeq = 0;
let qcSeq = 0;
const FROZEN_MS = 8 * 7 * DAY;

/** Premier créneau ≥ earliest de durée `hours` qui ne chevauche aucun blocage. */
function firstFreeSlot(m: Machine, earliest: number, hours: number): number {
  let start = Math.max(earliest, m.free);
  for (const [bs, be] of m.blocked) {
    if (be <= start) continue;
    if (bs >= start + hours * HOUR) break;
    start = be;
  }
  return start;
}

function orderStatus(start: number, end: number): string {
  if (end <= ASOF) return "Terminé";
  if (start <= ASOF) return "En cours";
  if (start <= ASOF + FROZEN_MS) return "Confirmé";
  return "Planifié";
}

for (const lot of lots) {
  const p = lot.product;
  const priority = p.family === "Formulation Injectable" ? pick(["Critique", "Haute"]) : pick(["Haute", "Normale", "Normale"]);
  let earliest = lot.release;
  for (const step of routings.get(p.product_id)!) {
    // Machine du type qui termine le plus tôt : vide de ligne seulement si elle vient
    // de traiter le même produit, changement de série complet sinon.
    let best: { m: Machine; slot: number; setup: number } | null = null;
    const runHours = lot.qty / machinesBySiteType.get(`${p.site}|${step.machineType}`)![0].capacity;
    for (const cand of machinesBySiteType.get(`${p.site}|${step.machineType}`)!) {
      const setup = cand.lastProduct === p.product_id ? cand.clearance : cand.changeover;
      const slot = firstFreeSlot(cand, earliest, setup + runHours);
      if (!best || slot + setup * HOUR < best.slot + best.setup * HOUR) best = { m: cand, slot, setup };
    }
    const m = best!.m;
    const start = best!.slot + best!.setup * HOUR;
    const end = start + runHours * HOUR;
    m.free = end;
    m.lastProduct = p.product_id;
    orderSeq++;
    orders.push({
      order_id: `OF-${String(orderSeq).padStart(6, "0")}`,
      lot_id: lot.lot_id,
      product_id: p.product_id,
      step_no: step.stepNo,
      machine_id: m.machine_id,
      campaign_id: lot.campaign_id,
      start,
      end,
      qty: lot.qty,
      status: orderStatus(start, end),
      priority,
    });

    earliest = end + TRANSFER_HOURS * HOUR;
    if (!step.qc) continue;

    const sampledLead = Math.max(step.qc.leadMean * 0.3, normal(step.qc.leadMean, step.qc.leadSd));
    const actualRelease = end + sampledLead * HOUR;
    qcSeq++;
    const qc: QcResult = {
      qc_id: `QC-${String(qcSeq).padStart(6, "0")}`,
      lot_id: lot.lot_id,
      product_id: p.product_id,
      step_no: step.stepNo,
      qc_point: step.qc.point,
      sample: end,
      release: end + step.qc.leadMean * HOUR,
      attribute: step.qc.attribute,
      value: null,
      low: step.qc.low,
      high: step.qc.high,
      result: end <= ASOF ? "En cours d'analyse" : "Planifié",
    };
    qcResults.push(qc);
    if (actualRelease > ASOF) {
      // Résultat inconnu à la date d'extraction : le plan suppose la conformité,
      // libération prévue au délai moyen.
      earliest = qc.release + TRANSFER_HOURS * HOUR;
      continue;
    }
    const value = Math.round(normal(step.processMean!, step.processSd!) * 10) / 10;
    qc.value = value;
    qc.release = actualRelease;
    const conform = value >= step.qc.low && value <= step.qc.high;
    qc.result = conform ? "Conforme" : "Hors spécifications";
    if (!conform) break; // lot rejeté : aucune opération aval
    earliest = actualRelease + TRANSFER_HOURS * HOUR;
  }
}

// ---------------------------------------------------------------------------
// Écriture

function fmtDateTime(t: number): string {
  return new Date(t).toISOString().slice(0, 16).replace("T", " ");
}
function writeCsv(file: string, header: string[], rows: (string | number | null)[][]): void {
  const esc = (v: string | number | null) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const content = [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
  writeFileSync(path.join(OUT_DIR, file), content);
}

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(PRODUCTS_FILE, path.join(OUT_DIR, "01_products.csv"));
copyFileSync(FORECASTS_FILE, path.join(OUT_DIR, "03_forecasts.csv"));
copyFileSync(EMPLOYEES_FILE, path.join(OUT_DIR, "07_hr_resources.csv"));
copyFileSync(ABSENCES_FILE, path.join(OUT_DIR, "08_hr_absences.csv"));

writeCsv(
  "02_machines.csv",
  [
    "machine_id",
    "machine_name",
    "machine_type",
    "process_family",
    "site",
    "production_line",
    "capacity_per_hour_units",
    "changeover_time_hours",
    "line_clearance_hours",
    "oee_target_pct",
    "status",
    "commissioning_year",
  ],
  machines.map((m) => [
    m.machine_id,
    m.machine_name,
    m.machine_type,
    m.process_family,
    m.site,
    m.production_line,
    m.capacity,
    m.changeover,
    m.clearance,
    m.oee,
    "Opérationnelle",
    m.commissioning,
  ])
);

writeCsv(
  "04_production_plan.csv",
  ["order_id", "lot_id", "product_id", "step_no", "machine_id", "campaign_id", "planned_start", "planned_end", "batch_qty_units", "status", "priority"],
  orders.map((o) => [o.order_id, o.lot_id, o.product_id, o.step_no, o.machine_id, o.campaign_id, fmtDateTime(o.start), fmtDateTime(o.end), o.qty, o.status, o.priority])
);

writeCsv(
  "05_maintenance_plan.csv",
  ["maintenance_id", "machine_id", "maintenance_type", "planned_date", "duration_hours", "frequency", "mttr_hours_avg", "mtbf_days_avg", "status"],
  maintenances.map((mt, i) => [
    `MNT-${String(i + 1).padStart(5, "0")}`,
    mt.machine_id,
    mt.type,
    mt.date,
    mt.duration,
    mt.frequency,
    Math.round(uniform(4, 20) * 10) / 10,
    Math.round(uniform(60, 400)),
    ts(mt.date) < ASOF ? "Réalisée" : "Planifiée",
  ])
);

writeCsv(
  "06_shutdowns.csv",
  ["shutdown_id", "site", "production_line", "start_date", "end_date", "reason", "impact_capacity_pct"],
  shutdowns.map((sd, i) => [`SD-${String(i + 1).padStart(4, "0")}`, sd.site, sd.line, sd.start, sd.end, sd.reason, 100])
);

writeCsv(
  "09_routings.csv",
  [
    "routing_id",
    "product_id",
    "step_no",
    "operation",
    "machine_type",
    "site",
    "qc_point",
    "qc_attribute",
    "spec_lower",
    "spec_upper",
    "qc_lead_time_mean_hours",
    "qc_lead_time_sd_hours",
  ],
  products.flatMap((p) =>
    routings.get(p.product_id)!.map((s) => [
      `RTG-${p.product_id}-${s.stepNo}`,
      p.product_id,
      s.stepNo,
      s.operation,
      s.machineType,
      p.site,
      s.qc?.point ?? null,
      s.qc?.attribute ?? null,
      s.qc?.low ?? null,
      s.qc?.high ?? null,
      s.qc?.leadMean ?? null,
      s.qc?.leadSd ?? null,
    ])
  )
);

writeCsv(
  "10_quality_results.csv",
  ["qc_id", "lot_id", "product_id", "step_no", "qc_point", "sample_date", "release_date", "qc_attribute", "measured_value", "spec_lower", "spec_upper", "result"],
  qcResults.map((q) => [
    q.qc_id,
    q.lot_id,
    q.product_id,
    q.step_no,
    q.qc_point,
    fmtDateTime(q.sample),
    fmtDateTime(q.release),
    q.attribute,
    q.value,
    q.low,
    q.high,
    q.result,
  ])
);

// ---------------------------------------------------------------------------
// Résumé (stderr) pour contrôle rapide

const known = qcResults.filter((q) => q.result === "Conforme" || q.result === "Hors spécifications");
const rejected = known.filter((q) => q.result === "Hors spécifications");
console.error(
  `[generate] ${machines.length} machines, ${lots.length} lots, ${orders.length} OF, ${qcResults.length} contrôles QC ` +
    `(${known.length} résultats connus, ${rejected.length} hors spécifications = ${((rejected.length / Math.max(1, known.length)) * 100).toFixed(1)} %).`
);
console.error(`[generate] produits à problème : ${[...problemProducts].join(", ")}`);
console.error(
  `[generate] rendement QC attendu : min ${(Math.min(...expectedYield.values()) * 100).toFixed(1)} %, ` +
    `médiane ${(median([...expectedYield.values()]) * 100).toFixed(2)} %`
);
console.error(`[generate] écrit dans ${OUT_DIR}`);
