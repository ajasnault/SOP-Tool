interface SiteFilterProps {
  sites: string[];
  value: string | undefined;
  onChange: (site: string | undefined) => void;
}

/** "Site A - Lyon" -> "Lyon" pour l'onglet, cohérent avec la maquette. */
function shortLabel(site: string): string {
  const parts = site.split("-");
  return parts.length > 1 ? parts[parts.length - 1].trim() : site;
}

export function SiteFilter({ sites, value, onChange }: SiteFilterProps) {
  return (
    <div className="flex overflow-hidden rounded-sm border border-border text-[12px] font-medium">
      <button
        onClick={() => onChange(undefined)}
        className={value === undefined ? "bg-navy px-3 py-1.5 text-white" : "px-3 py-1.5 text-slate"}
      >
        Consolidé
      </button>
      {sites.map((site) => (
        <button
          key={site}
          onClick={() => onChange(site)}
          className={value === site ? "bg-navy px-3 py-1.5 text-white" : "px-3 py-1.5 text-slate"}
        >
          {shortLabel(site)}
        </button>
      ))}
    </div>
  );
}
