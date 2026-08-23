import type { LiveStatus } from "@/api/useLiveDashboard";

const ITEMS: { key: LiveStatus; label: string }[] = [
  { key: "nominal", label: "Nominal" },
  { key: "refreshing", label: "Rafraîch." },
  { key: "error", label: "Erreur" },
];

/** Reflète l'état réel de la connexion aux données (pas un état simulé). */
export function StateSwitch({ status }: { status: LiveStatus }) {
  const active = status === "loading" ? "nominal" : status;
  return (
    <div className="flex overflow-hidden rounded-sm border border-border text-[12px] font-medium">
      {ITEMS.map((item) => {
        const isActive = item.key === active;
        return (
          <div
            key={item.key}
            className={
              isActive
                ? item.key === "error"
                  ? "bg-red px-3 py-1.5 text-white"
                  : "bg-navy px-3 py-1.5 text-white"
                : "px-3 py-1.5 text-slate"
            }
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
