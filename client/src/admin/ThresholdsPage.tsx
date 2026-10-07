import { useEffect, useState } from "react";
import { fetchThresholds, updateThreshold } from "@/api/adminClient";
import type { Thresholds } from "@/api/adminTypes";
import type { DashboardSummary } from "@/api/types";
import { fetchDashboard } from "@/api/client";

interface ThresholdMeta {
  key: keyof Thresholds;
  label: string;
  description: string;
  defaultValue: number;
  step: number;
  unit: string;
}

const THRESHOLDS: ThresholdMeta[] = [
  {
    key: "capacity_utilization_gap_pct",
    label: "Sur-utilisation machine",
    description: "Vue capacité — au-delà de ce taux, une machine est signalée en dépassement.",
    defaultValue: 90,
    step: 1,
    unit: "%",
  },
  {
    key: "mapping_confidence_min",
    label: "Confiance minimale du mapping",
    description: "Ingestion — sous ce score, l'import d'une signature jamais vue est bloqué avant écriture en base.",
    defaultValue: 0.75,
    step: 0.05,
    unit: "",
  },
  {
    key: "source_staleness_warning_hours",
    label: "Fraîcheur maximale d'une source",
    description: "Sources connectées — au-delà, une source est signalée périmée.",
    defaultValue: 24,
    step: 1,
    unit: "h",
  },
  {
    key: "frozen_period_weeks",
    label: "Durée de la période gelée",
    description: "Mode présentation — repère visuel sur le graphique demande, à partir du cycle consulté. Ne bloque aucune écriture.",
    defaultValue: 8,
    step: 1,
    unit: "sem.",
  },
  {
    key: "service_level_target_pct",
    label: "Cible de taux de service",
    description: "Synthèse exécutive — en dessous de cette cible, le taux de service prévisionnel est signalé en rouge.",
    defaultValue: 95,
    step: 1,
    unit: "%",
  },
];

export function ThresholdsPage() {
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<keyof Thresholds, string>>>({});
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function reload() {
    const [t, d] = await Promise.all([fetchThresholds(), fetchDashboard()]);
    setThresholds(t);
    setDashboard(d);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSave(key: keyof Thresholds) {
    const raw = drafts[key];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setSavingKey(key);
    try {
      await updateThreshold(key, value);
      await reload();
      setDrafts((d) => ({ ...d, [key]: undefined }));
    } finally {
      setSavingKey(null);
    }
  }

  const capacityRows = dashboard?.capacity ?? [];
  const overThreshold = capacityRows.filter((r) => r.utilization_pct !== null && r.utilization_pct > (thresholds?.capacity_utilization_gap_pct ?? 90));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-5">
        <div className="text-[12px] text-slate">Administration / Seuils d'alerte</div>
        <h1 className="font-serif text-3xl text-navy">Seuils d'alerte</h1>
        <div className="mt-1 text-[12px] text-slate">
          Table <span className="font-mono">alert_thresholds</span> — effet immédiat sur le mode présentation.
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!thresholds ? (
          <div className="text-[14px] text-slate">Chargement…</div>
        ) : (
          <div className="grid grid-cols-[1fr_320px] gap-8">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-slate">
                  <th className="py-2 pr-4 font-medium">Seuil</th>
                  <th className="py-2 pr-4 font-medium">Valeur</th>
                  <th className="py-2 font-medium">Défaut</th>
                </tr>
              </thead>
              <tbody>
                {THRESHOLDS.map((meta) => {
                  const current = thresholds[meta.key];
                  const draft = drafts[meta.key];
                  const dirty = draft !== undefined && Number(draft) !== current;
                  return (
                    <tr key={meta.key} className="border-b border-border align-top">
                      <td className="py-3 pr-4">
                        <div className="font-medium text-ink">{meta.label}</div>
                        <div className="font-mono text-[11px] text-slate">{meta.key}</div>
                        <div className="mt-0.5 max-w-[280px] text-[12px] text-slate">{meta.description}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step={meta.step}
                            value={draft ?? current}
                            onChange={(e) => setDrafts((d) => ({ ...d, [meta.key]: e.target.value }))}
                            className="w-24 rounded-sm border border-border px-2 py-1 font-mono text-[13px]"
                          />
                          <span className="text-slate">{meta.unit}</span>
                          {dirty && (
                            <button
                              onClick={() => handleSave(meta.key)}
                              disabled={savingKey === meta.key}
                              className="rounded-sm bg-navy px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-40"
                            >
                              {savingKey === meta.key ? "…" : "Enregistrer"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-slate">
                        {meta.defaultValue}
                        {meta.unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="border-l border-border pl-6">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate">Aperçu de l'impact</div>
              {dashboard?.cycleReferenceMonth ? (
                <>
                  <div className="font-serif text-3xl text-red">{overThreshold.length}</div>
                  <div className="text-[12px] text-slate">
                    machine{overThreshold.length > 1 ? "s" : ""} en dépassement sur {capacityRows.length}, au seuil actuel — mois de
                    référence {dashboard.cycleReferenceMonth}
                    {dashboard.isCurrentCycle ? " (cycle courant)" : " (cycle historique)"}.
                  </div>
                  {overThreshold.length > 0 && (
                    <ul className="mt-3 space-y-1 text-[13px] text-ink">
                      {overThreshold.map((r) => (
                        <li key={r.machine_id} className="flex justify-between">
                          <span>{r.machine_name}</span>
                          <span className="font-mono text-red">{r.utilization_pct?.toFixed(1)}%</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4 text-[12px] text-slate">
                    Recalculé sur les mêmes données que le mode présentation — ajuster le seuil ci-contre puis enregistrer met à
                    jour ce chiffre après rechargement.
                  </div>
                </>
              ) : (
                <div className="text-[13px] text-slate">Pas de données de capacité disponibles.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
