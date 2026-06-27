interface MobileTabsProps {
  activeTab: string;
  onChange: (tab: string) => void;
}

const TABS = [
  { id: "live", label: "Live" },
  { id: "events", label: "Events" },
  { id: "evidence", label: "Evidence" },
  { id: "files", label: "Files" },
];

export function MobileTabs({ activeTab, onChange }: MobileTabsProps) {
  return (
    <nav
      className="relative z-[55] flex gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 lg:hidden"
      aria-label="Dashboard sections"
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-selected={active}
            className={`flex-1 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
