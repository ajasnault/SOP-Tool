import { useEffect, useState } from "react";
import type { DashboardSummary } from "@/api/types";
import type { Decision, DecisionStatus, OptionSnapshot } from "@/api/decisionTypes";
import { fetchDecisions, createDecision, updateDecision, deleteDecision } from "@/api/client";
import { apiUrl } from "@/api/apiBase";
import { useDecisionDraft } from "../decisionDraftContext";

const STATUS_LABELS: Record<DecisionStatus, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  fait: "Fait",
  abandonne: "Abandonné",
};

const STATUS_ORDER: DecisionStatus[] = ["a_faire", "en_cours", "fait", "abandonne"];

function StatusBadge({ status }: { status: DecisionStatus }) {
  const cls =
    status === "fait"
      ? "bg-navy text-white"
      : status === "en_cours"
        ? "bg-teal text-white"
        : status === "abandonne"
          ? "bg-bg-alt text-slate italic"
          : "border border-border text-slate";
  return <span className={`inline-block rounded-sm px-2 py-0.5 text-[12px] font-medium ${cls}`}>{STATUS_LABELS[status]}</span>;
}

interface FormState {
  description: string;
  owner: string;
  due_date: string;
  status: DecisionStatus;
}

const EMPTY_FORM: FormState = { description: "", owner: "", due_date: "", status: "a_faire" };

export function Decisions({ data, site }: { data: DashboardSummary; site: string | undefined }) {
  const { draft, setDraft } = useDecisionDraft();
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const reload = () => fetchDecisions(site).then(setDecisions).catch((e) => setError((e as Error).message));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  const [draftSourceTitle, setDraftSourceTitle] = useState<string | null>(null);
  const [draftOptionSnapshot, setDraftOptionSnapshot] = useState<OptionSnapshot | null>(null);

  useEffect(() => {
    if (draft !== null) {
      setForm({ ...EMPTY_FORM, description: draft.description });
      setDraftSourceTitle(draft.sourceOptionTitle);
      setDraftOptionSnapshot({ option: draft.optionSnapshot, thresholdPct: draft.thresholdPct });
      setShowForm(true);
      setDraft(null);
    }
  }, [draft, setDraft]);

  const handleCreate = () => {
    if (!form.description.trim()) return;
    setError(null);
    createDecision({
      description: form.description.trim(),
      owner: form.owner.trim() || null,
      due_date: form.due_date || null,
      status: form.status,
      site: site ?? null,
      source_option_title: draftSourceTitle,
      option_snapshot: draftOptionSnapshot,
      cycle_reference_month: data.cycleReferenceMonth,
    })
      .then(() => {
        setForm(EMPTY_FORM);
        setDraftSourceTitle(null);
        setDraftOptionSnapshot(null);
        setShowForm(false);
        reload();
      })
      .catch((e) => setError((e as Error).message));
  };

  const startEdit = (d: Decision) => {
    setEditingId(d.id);
    setEditForm({ description: d.description, owner: d.owner ?? "", due_date: d.due_date ?? "", status: d.status });
  };

  const saveEdit = (id: number) => {
    setError(null);
    updateDecision(id, {
      description: editForm.description.trim(),
      owner: editForm.owner.trim() || null,
      due_date: editForm.due_date || null,
      status: editForm.status,
    })
      .then(() => {
        setEditingId(null);
        reload();
      })
      .catch((e) => setError((e as Error).message));
  };

  const changeStatus = (d: Decision, status: DecisionStatus) => {
    setError(null);
    updateDecision(d.id, { status }).then(reload).catch((e) => setError((e as Error).message));
  };

  const remove = (id: number) => {
    setError(null);
    deleteDecision(id).then(reload).catch((e) => setError((e as Error).message));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-12 py-10">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-teal">05 · Décisions</div>
          <h1 className="font-serif text-4xl text-navy">Plan d'action</h1>
        </div>
        <button
          onClick={() => {
            setForm(EMPTY_FORM);
            setDraftSourceTitle(null);
            setDraftOptionSnapshot(null);
            setShowForm((v) => !v);
          }}
          className="rounded-sm bg-navy px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-dark"
        >
          {showForm ? "Annuler" : "+ Nouvelle décision"}
        </button>
      </header>

      {error && <div className="mt-4 border border-red bg-red-pale px-4 py-3 text-[13px] text-red">{error}</div>}

      {showForm && (
        <div className="mt-4 border border-border bg-bg-alt p-4">
        {draftSourceTitle && (
          <div className="mb-3 text-[12px] text-teal-dark">Pré-rempli depuis la proposition « {draftSourceTitle} »</div>
        )}
        <div className="grid grid-cols-[1fr_180px_150px_140px_auto] items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-slate">
            Description
            <input
              autoFocus
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="border border-border bg-white px-2 py-1.5 text-[13px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-slate">
            Responsable
            <input
              value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
              className="border border-border bg-white px-2 py-1.5 text-[13px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-slate">
            Échéance
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="border border-border bg-white px-2 py-1.5 text-[13px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-slate">
            Statut
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as DecisionStatus })}
              className="border border-border bg-white px-2 py-1.5 text-[13px] text-ink"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleCreate}
            disabled={!form.description.trim()}
            className="rounded-sm bg-teal-dark px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            Ajouter
          </button>
        </div>
        </div>
      )}

      <table className="mt-6 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-slate">
            <th className="py-2">Description</th>
            <th className="py-2">Responsable</th>
            <th className="py-2">Échéance</th>
            <th className="py-2">Statut</th>
            <th className="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {decisions === null && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate">
                Chargement…
              </td>
            </tr>
          )}
          {decisions !== null && decisions.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate">
                Aucune décision enregistrée pour l'instant.
              </td>
            </tr>
          )}
          {decisions?.map((d) =>
            editingId === d.id ? (
              <tr key={d.id} className="border-b border-border align-top">
                <td className="py-2 pr-3">
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full border border-border px-2 py-1 text-[13px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    value={editForm.owner}
                    onChange={(e) => setEditForm({ ...editForm, owner: e.target.value })}
                    className="w-full border border-border px-2 py-1 text-[13px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="date"
                    value={editForm.due_date}
                    onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                    className="w-full border border-border px-2 py-1 text-[13px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value as DecisionStatus })}
                    className="w-full border border-border px-2 py-1 text-[13px]"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right">
                  <button onClick={() => saveEdit(d.id)} className="mr-2 text-teal-dark hover:underline">
                    Enregistrer
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-slate hover:underline">
                    Annuler
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={d.id} className="border-b border-border">
                <td className="py-2 pr-3 text-ink">
                  {d.description}
                  {d.site && <span className="ml-2 text-[11px] text-teal-dark">[{d.site}]</span>}
                  {d.source_option_title && (
                    <div className="text-[11px] text-slate">Depuis la proposition : {d.source_option_title}</div>
                  )}
                </td>
                <td className="py-2 pr-3 text-ink">{d.owner ?? "—"}</td>
                <td className="py-2 pr-3 text-ink">{d.due_date ?? "—"}</td>
                <td className="py-2 pr-3">
                  <div className="relative inline-block">
                    <StatusBadge status={d.status} />
                    <select
                      aria-label="Changer le statut"
                      value={d.status}
                      onChange={(e) => changeStatus(d, e.target.value as DecisionStatus)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="py-2 text-right">
                  {d.option_snapshot && (
                    <a
                      href={apiUrl(`/api/export/reconciliation-plan/${d.id}`)}
                      className="mr-3 text-teal-dark hover:underline"
                      title="Document de synthèse à transmettre aux équipes — n'écrit aucun ordre de fabrication"
                    >
                      Exporter le plan (PPTX)
                    </a>
                  )}
                  <button onClick={() => startEdit(d)} className="mr-3 text-teal-dark hover:underline">
                    Modifier
                  </button>
                  <button onClick={() => remove(d.id)} className="text-slate hover:underline">
                    Supprimer
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
