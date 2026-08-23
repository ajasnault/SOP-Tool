// Voir server/src/export/pptx.ts pour le contexte du contournement de typage pptxgenjs.
import PptxGenJSCtor from "pptxgenjs";
const PptxGenJS = PptxGenJSCtor as unknown as new () => PptxInstance;
type PptxInstance = any;
type Slide = any;

import type { ReconciliationOptionWithGaps } from "../llm/reconciliationClient.js";

const NAVY = "21295C";
const TEAL = "1C7293";
const RED = "B23A2E";
const SLATE = "5B6480";
const BORDER = "D9DCE3";
const BG = "F2F2F2";

const TYPE_LABELS: Record<string, string> = {
  lissage_temporel: "Lissage temporel",
  ouverture_ligne: "Ouverture de ligne",
  fermeture_ligne: "Fermeture de ligne",
  mixte: "Mixte",
};

const STATUS_LABELS: Record<string, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  fait: "Fait",
  abandonne: "Abandonné",
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface DecisionForExport {
  description: string;
  owner: string | null;
  due_date: string | null;
  status: string;
  site: string | null;
}

export interface OptionSnapshot {
  option: ReconciliationOptionWithGaps;
  thresholdPct: number;
}

/**
 * Document de synthèse d'une décision de réconciliation, à transmettre aux
 * équipes — PAS un plan de production réel : aucun ordre de fabrication n'est
 * modifié en base (voir docs/calculations.md, "Propositions de réconciliation
 * (LLM)"). Ce document décrit QUOI faire (machine, mois, impact attendu déjà
 * recalculé par l'app) ; la replanification effective des ordres reste à
 * réaliser par les équipes.
 */
export async function buildReconciliationPlanPptx(decision: DecisionForExport, snapshot: OptionSnapshot): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SOP_16x9", width: 13.33, height: 7.5 });
  pptx.layout = "SOP_16x9";

  addTitleSlide(pptx, decision);
  addRationaleSlide(pptx, snapshot.option);
  addImpactSlide(pptx, snapshot);

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

function addTitleSlide(pptx: PptxInstance, decision: DecisionForExport) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  slide.addText("PLAN DE LISSAGE — SYNTHÈSE À TRANSMETTRE", { x: 0.7, y: 2.2, w: 12, h: 0.5, fontSize: 13, bold: true, color: TEAL, charSpacing: 2 });
  slide.addText(decision.description, { x: 0.7, y: 2.7, w: 12, h: 1.4, fontSize: 28, color: NAVY, fontFace: "Georgia", valign: "top" });

  const meta = [
    `Responsable : ${decision.owner ?? "non assigné"}`,
    `Échéance : ${decision.due_date ?? "non définie"}`,
    `Statut : ${STATUS_LABELS[decision.status] ?? decision.status}`,
    `Périmètre : ${decision.site ?? "Consolidé — tous sites"}`,
  ];
  slide.addText(meta.join("   ·   "), { x: 0.7, y: 4.3, w: 12, h: 0.5, fontSize: 13, color: SLATE });

  slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 5.3, w: 0.06, h: 1.2, fill: { color: TEAL } });
  slide.addText(
    "Ce document synthétise une proposition de réconciliation et son impact attendu, déjà recalculé par l'outil. " +
      "Aucun ordre de fabrication n'a été modifié automatiquement — la replanification reste à réaliser par les équipes.",
    { x: 0.95, y: 5.35, w: 11.3, h: 1.1, fontSize: 12, color: "16181F", italic: true, valign: "top" }
  );
}

function addRationaleSlide(pptx: PptxInstance, option: ReconciliationOptionWithGaps) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  addHeader(slide, `TYPE : ${(TYPE_LABELS[option.type] ?? option.type).toUpperCase()}`, option.title);

  const bulletText = option.description_bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } }));
  slide.addText(bulletText, { x: 0.7, y: 1.7, w: 11.9, h: 3.8, fontSize: 15, color: "16181F", valign: "top", paraSpaceAfter: 10 });

  if (option.months_concerned.length > 0) {
    slide.addText(`Mois concernés : ${option.months_concerned.join(", ")}`, { x: 0.7, y: 5.7, w: 11.9, h: 0.4, fontSize: 12, color: SLATE });
  }
  if (option.missing_data_warning) {
    slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 6.2, w: 11.9, h: 0.9, fill: { color: "FFFFFF" }, line: { color: BORDER, width: 1 } });
    slide.addText(`⚠ ${option.missing_data_warning}`, { x: 0.9, y: 6.3, w: 11.5, h: 0.7, fontSize: 11, color: SLATE, valign: "top" });
  }

  addFooter(slide);
}

function addImpactSlide(pptx: PptxInstance, snapshot: OptionSnapshot) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  addHeader(slide, "IMPACT ATTENDU", "Gaps résultants — recalculés par l'application, pas par le LLM");

  const entries = snapshot.option.resulting_gaps.flatMap((g) => g.entries);

  const header = [
    { text: "Machine / ligne — mois", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
    { text: "Avant", options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" as const } },
    { text: "Après", options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" as const } },
    { text: "Note", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
  ];
  const body = entries.map((e) => {
    const overThreshold = e.after_utilization_pct !== null && e.after_utilization_pct > snapshot.thresholdPct;
    return [
      { text: e.scope, options: { color: "16181F", fontSize: 10 } },
      { text: e.before_utilization_pct !== null ? `${round1(e.before_utilization_pct)} %` : "n/a", options: { align: "right" as const, color: SLATE, fontSize: 10 } },
      {
        text: e.after_utilization_pct !== null ? `${round1(e.after_utilization_pct)} %` : "n/a",
        options: { align: "right" as const, bold: overThreshold, color: overThreshold ? RED : "16181F", fontSize: 10 },
      },
      { text: e.note ?? "", options: { color: SLATE, fontSize: 9 } },
    ];
  });

  if (body.length > 0) {
    slide.addTable([header, ...body], {
      x: 0.6, y: 1.7, w: 12.1,
      fontSize: 10,
      border: { type: "solid", color: BORDER, pt: 0.5 },
      autoPage: false,
    });
  } else {
    slide.addText("Aucun gap résultant calculable pour cette option.", { x: 0.6, y: 1.7, w: 12, h: 0.5, fontSize: 13, color: SLATE });
  }

  slide.addText(`Seuil d'alerte : ${round1(snapshot.thresholdPct)} % — rouge = dépassement réel après application de l'option.`, {
    x: 0.6, y: 6.9, w: 12, h: 0.4, fontSize: 10, color: SLATE,
  });

  addFooter(slide);
}

function addHeader(slide: Slide, eyebrow: string, title: string) {
  slide.addText(eyebrow, { x: 0.6, y: 0.5, w: 11, h: 0.35, fontSize: 11, bold: true, color: TEAL, charSpacing: 1 });
  slide.addText(title, { x: 0.6, y: 0.85, w: 12, h: 0.7, fontSize: 22, color: NAVY, fontFace: "Georgia" });
  slide.addShape("line", { x: 0.6, y: 1.55, w: 12.1, h: 0, line: { color: BORDER, width: 1 } });
}

function addFooter(slide: Slide) {
  slide.addText("Document de synthèse généré depuis Outil S&OP — ne modifie aucune donnée de production.", {
    x: 0.6, y: 7.1, w: 12.1, h: 0.3, fontSize: 9, color: SLATE,
  });
}
