// Les types de `pptxgenjs` (fusion classe+namespace) ne se résolvent pas
// correctement sous "moduleResolution": "NodeNext" — le runtime fonctionne
// (vérifié), seul le typage statique est cassé. On type ce module en `any`
// localement plutôt que de lutter contre les .d.ts du paquet.
import PptxGenJSCtor from "pptxgenjs";
const PptxGenJS = PptxGenJSCtor as unknown as new () => PptxInstance;
type PptxInstance = any;
type Slide = any;

import type { DashboardSummary, MachineMonthCapacity } from "../calc/index.js";

const NAVY = "21295C";
const TEAL = "1C7293";
const RED = "B23A2E";
const SLATE = "5B6480";
const BORDER = "D9DCE3";
const BG = "F2F2F2";

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
function formatMonthFr(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${MONTHS_FR[m - 1]} ${year}`;
}
function quarterOf(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${year} T${Math.ceil(m / 3)}`;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Instantané PPTX du cycle S&OP, à partir des mêmes données que le mode
 * présentation (`computeDashboard`) — jamais de contenu fabriqué. Limité aux
 * 3 sections V1 (synthèse, demande, capacité) : réconciliation/décisions ne
 * sont pas calculables, cf. docs/design-gaps.md.
 */
export async function buildPptx(dashboard: DashboardSummary, site: string | undefined): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SOP_16x9", width: 13.33, height: 7.5 });
  pptx.layout = "SOP_16x9";

  const siteLabel = site ?? "Consolidé — tous sites";
  const cycleLabel = formatMonthFr(dashboard.cycleReferenceMonth);

  addTitleSlide(pptx, siteLabel, cycleLabel, dashboard.lastImportAt);
  addSummarySlide(pptx, dashboard, siteLabel);
  addDemandSlide(pptx, dashboard, siteLabel);
  addCapacitySlide(pptx, dashboard, siteLabel);

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

function addTitleSlide(pptx: PptxInstance, siteLabel: string, cycleLabel: string, lastImportAt: string | null) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  slide.addText("REVUE S&OP EXÉCUTIVE", { x: 0.7, y: 2.6, w: 12, h: 0.6, fontSize: 14, bold: true, color: TEAL, charSpacing: 2 });
  slide.addText(`Cycle de ${cycleLabel}`, { x: 0.7, y: 3.1, w: 12, h: 1, fontSize: 36, color: NAVY, fontFace: "Georgia" });
  slide.addText(siteLabel, { x: 0.7, y: 4.1, w: 12, h: 0.5, fontSize: 16, color: SLATE });
  if (lastImportAt) {
    slide.addText(`Données au ${lastImportAt} UTC`, { x: 0.7, y: 6.8, w: 12, h: 0.4, fontSize: 11, color: SLATE });
  }
}

function addSummarySlide(pptx: PptxInstance, dashboard: DashboardSummary, siteLabel: string) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  addHeader(slide, "01 · SYNTHÈSE EXÉCUTIVE", "Indicateurs clés du cycle", siteLabel);

  const month = dashboard.cycleReferenceMonth;
  const capacityRows = dashboard.capacity;
  const hrRows = dashboard.hrAvailability;

  const utilRows = capacityRows.filter((r) => r.utilization_pct !== null);
  const avgUtil = utilRows.length > 0 ? utilRows.reduce((s, r) => s + (r.utilization_pct ?? 0), 0) / utilRows.length : null;
  const gapsCurrent = capacityRows.filter((r) => r.utilization_pct !== null && (r.utilization_pct as number) > dashboard.thresholdPct);
  const fteTotal = hrRows.reduce((s, r) => s + r.fte_total, 0);
  const fteAvailable = hrRows.reduce((s, r) => s + r.fte_available, 0);
  const hrAvailPct = fteTotal > 0 ? (fteAvailable / fteTotal) * 100 : null;

  const kpis: { label: string; value: string; caption: string; tone: string }[] = [
    {
      label: "Utilisation moyenne capacité",
      value: avgUtil !== null ? `${round1(avgUtil)} %` : "—",
      caption: `${capacityRows.length} machines`,
      tone: avgUtil !== null && avgUtil > dashboard.thresholdPct ? RED : NAVY,
    },
    {
      label: "Machines en dépassement de seuil",
      value: `${gapsCurrent.length} / ${capacityRows.length}`,
      caption: `seuil ${round1(dashboard.thresholdPct)} %`,
      tone: gapsCurrent.length > 0 ? RED : NAVY,
    },
    {
      label: "Disponibilité RH",
      value: hrAvailPct !== null ? `${round1(hrAvailPct)} %` : "—",
      caption: "FTE nets d'absences",
      tone: NAVY,
    },
  ];

  const cardW = 3.7;
  kpis.forEach((kpi, i) => {
    const x = 0.7 + i * (cardW + 0.3);
    slide.addShape(pptx.ShapeType.rect, { x, y: 1.7, w: cardW, h: 1.9, fill: { color: "FFFFFF" }, line: { color: BORDER, width: 1 } });
    slide.addText(kpi.label, { x: x + 0.25, y: 1.85, w: cardW - 0.5, h: 0.5, fontSize: 11, color: SLATE });
    slide.addText(kpi.value, { x: x + 0.25, y: 2.3, w: cardW - 0.5, h: 0.7, fontSize: 30, color: kpi.tone, fontFace: "Georgia" });
    slide.addText(kpi.caption, { x: x + 0.25, y: 3.0, w: cardW - 0.5, h: 0.4, fontSize: 10, color: SLATE });
  });

  const worstGap = [...gapsCurrent].sort((a, b) => (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0))[0];
  slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 4.1, w: 0.06, h: 1.6, fill: { color: worstGap ? RED : BORDER } });
  slide.addText(worstGap ? "POINT D'ATTENTION" : "AUCUN POINT D'ATTENTION", {
    x: 0.95, y: 4.15, w: 11, h: 0.35, fontSize: 11, bold: true, color: worstGap ? RED : SLATE,
  });
  slide.addText(
    worstGap
      ? `${worstGap.machine_name} (${worstGap.site ?? "—"} · ${worstGap.production_line ?? "—"}) est planifiée à ` +
          `${round1(worstGap.utilization_pct as number)} % de sa capacité disponible sur ${month ? formatMonthFr(month) : "—"} ` +
          `— seuil ${round1(dashboard.thresholdPct)} %.`
      : `Aucune machine au-dessus du seuil de ${round1(dashboard.thresholdPct)} % ce mois-ci${siteLabel.startsWith("Consolidé") ? "" : ` sur ${siteLabel}`}.`,
    { x: 0.95, y: 4.55, w: 11.2, h: 1.1, fontSize: 13, color: "16181F", valign: "top" }
  );

  addFooter(slide);
}

function addDemandSlide(pptx: PptxInstance, dashboard: DashboardSummary, siteLabel: string) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  addHeader(slide, "02 · REVUE DE LA DEMANDE", `Forecast consensus — ${siteLabel}`, "");

  const trend = dashboard.demandTrend;
  if (trend.length > 0) {
    slide.addChart(
      pptx.ChartType.line,
      [{ name: "Demande consolidée", labels: trend.map((r) => r.month), values: trend.map((r) => r.qty_units) }],
      {
        x: 0.6, y: 1.6, w: 12.1, h: 2.7,
        lineSize: 2,
        chartColors: [NAVY],
        catAxisLabelFontSize: 8,
        valAxisLabelFontSize: 8,
        showLegend: false,
        valAxisLabelFormatCode: "#,##0",
      }
    );
  }

  const families = [...new Set(dashboard.demandByFamily.map((r) => r.group))].sort();
  const quarterMap = new Map<string, Record<string, number>>();
  for (const row of dashboard.demandByFamily) {
    const q = quarterOf(row.period);
    if (!quarterMap.has(q)) quarterMap.set(q, {});
    quarterMap.get(q)![row.group] = (quarterMap.get(q)![row.group] ?? 0) + row.qty_units;
  }
  const quarters = [...quarterMap.keys()].sort();
  const familyColors = ["21295C", "0A4A73", "065A82", "1C7293", "6E9FB4", "A9CBD9"];

  if (quarters.length > 0 && families.length > 0) {
    const series = families.map((f) => ({ name: f, labels: quarters, values: quarters.map((q) => quarterMap.get(q)?.[f] ?? 0) }));
    slide.addChart(pptx.ChartType.bar, series, {
      x: 0.6, y: 4.5, w: 12.1, h: 2.5,
      barGrouping: "stacked",
      chartColors: familyColors,
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 8,
      showLegend: true,
      legendFontSize: 9,
      legendPos: "b",
    });
  }

  addFooter(slide);
}

function addCapacitySlide(pptx: PptxInstance, dashboard: DashboardSummary, siteLabel: string) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  const month = dashboard.cycleReferenceMonth;
  addHeader(slide, "03 · REVUE DE LA CAPACITÉ", `Utilisation planifiée — ${formatMonthFr(month)}`, siteLabel);

  const rows: MachineMonthCapacity[] = dashboard.capacity
    .slice()
    .sort((a, b) => (b.utilization_pct ?? -1) - (a.utilization_pct ?? -1))
    .slice(0, 14); // tient sur une slide ; le détail complet reste dans le mode présentation live

  const header = [
    { text: "Machine", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
    { text: "Site · ligne", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
    { text: "Utilisation", options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" as const } },
  ];
  const body = rows.map((r) => {
    const over = r.utilization_pct !== null && r.utilization_pct > dashboard.thresholdPct;
    return [
      { text: r.machine_name, options: { color: "16181F" } },
      { text: `${r.site ?? "—"} · ${r.production_line ?? "—"}`, options: { color: SLATE, fontSize: 10 } },
      {
        text: r.utilization_pct !== null ? `${round1(r.utilization_pct)} %` : "n/a",
        options: { align: "right" as const, bold: over, color: over ? RED : "16181F" },
      },
    ];
  });

  slide.addTable([header, ...body], {
    x: 0.6, y: 1.6, w: 12.1,
    fontSize: 11,
    border: { type: "solid", color: BORDER, pt: 0.5 },
    autoPage: false,
  });

  slide.addText(`Seuil de dépassement : ${round1(dashboard.thresholdPct)} % — source : production_orders × capacité disponible machines.`, {
    x: 0.6, y: 6.9, w: 12, h: 0.4, fontSize: 10, color: SLATE,
  });

  addFooter(slide);
}

function addHeader(slide: Slide, eyebrow: string, title: string, right: string) {
  slide.addText(eyebrow, { x: 0.6, y: 0.5, w: 8, h: 0.35, fontSize: 11, bold: true, color: TEAL, charSpacing: 1 });
  slide.addText(title, { x: 0.6, y: 0.85, w: 9, h: 0.6, fontSize: 26, color: NAVY, fontFace: "Georgia" });
  if (right) slide.addText(right, { x: 9.6, y: 0.6, w: 3.1, h: 0.5, fontSize: 11, color: SLATE, align: "right" });
  slide.addShape("line", { x: 0.6, y: 1.5, w: 12.1, h: 0, line: { color: BORDER, width: 1 } });
}

function addFooter(slide: Slide) {
  slide.addText("Revue S&OP — instantané généré depuis les données live. Réconciliation/décisions : export dédié depuis la vue Décisions.", {
    x: 0.6, y: 7.1, w: 12.1, h: 0.3, fontSize: 9, color: SLATE,
  });
}
