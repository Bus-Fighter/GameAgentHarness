import { Monitor, Zap, Image, FileText, Search, LayoutGrid } from "lucide-react";

interface MobileTabsProps {
  activeTab: string;
  onChange: (tab: string) => void;
}

const TABS = [
  { id: "live", label: "Live", icon: Monitor },
  { id: "events", label: "Events", icon: Zap },
  { id: "evidence", label: "Evidence", icon: Image },
  { id: "docks", label: "Docks", icon: LayoutGrid },
  { id: "inspect", label: "Inspect", icon: Search },
  { id: "files", label: "Files", icon: FileText },
];

export function MobileTabs({ activeTab, onChange }: MobileTabsProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[55] flex h-[var(--tabs-h)] items-center gap-1 border-t border-[var(--border)] bg-[rgba(15,23,42,0.98)] px-2 backdrop-blur"
      aria-label="Dashboard sections"
      role="tablist"
      style={{ viewTransitionName: "persistent-tabs" }}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] text-[var(--accent)]"
                : "border-transparent bg-transparent text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--text)]"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
