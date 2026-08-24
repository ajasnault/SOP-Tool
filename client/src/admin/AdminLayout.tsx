import { Link, NavLink, Outlet } from "react-router-dom";
import { apiUrl } from "@/api/apiBase";

const NAV = [
  { to: "/admin", label: "Import & mapping", end: true },
  { to: "/admin/sources", label: "Sources connectées", end: false },
  { to: "/admin/thresholds", label: "Seuils d'alerte", end: false },
];

export function AdminLayout() {
  return (
    <div className="fixed inset-0 flex bg-bg">
      <aside className="w-56 shrink-0 border-r border-border bg-white px-5 py-6">
        <div className="mb-6">
          <div className="font-serif text-lg text-navy">S&OP Planning</div>
          <div className="text-[11px] uppercase tracking-wide text-slate">Administration</div>
        </div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate">Données</div>
        <nav className="flex flex-col gap-1 text-[13px]">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-sm px-2 py-1.5 font-medium ${isActive ? "bg-navy text-white" : "text-ink hover:bg-bg-alt"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <a
          href={apiUrl("/api/export/pptx")}
          className="mt-8 block rounded-sm border border-navy px-2.5 py-1.5 text-center text-[13px] font-medium text-navy hover:bg-bg-alt"
        >
          Exporter ce cycle (PPTX)
        </a>
        <Link to="/" className="mt-3 block text-[12px] text-teal hover:underline">
          ← Ouvrir le mode présentation
        </Link>
      </aside>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
