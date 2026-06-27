import { ViewTransition } from "react";

interface TabPanelProps {
  children: React.ReactNode;
}

export function TabPanel({ children }: TabPanelProps) {
  return (
    <ViewTransition enter="fade-in" exit="fade-out" default="none">
      <main className="flex flex-1 flex-col gap-3 overflow-hidden p-3 pb-[calc(var(--tabs-h)+var(--toolbar-h)+28px)] lg:grid lg:grid-cols-[1.4fr_1fr] lg:grid-rows-[auto_1fr_auto] lg:items-start lg:gap-4 lg:overflow-visible lg:p-4 lg:pb-[calc(var(--toolbar-h)+24px)]">
        {children}
      </main>
    </ViewTransition>
  );
}
