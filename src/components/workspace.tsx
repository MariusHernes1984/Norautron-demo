"use client";

import { BarChart3, Database, MessageSquareText, ShieldCheck } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { ChatWorkspace } from "./chat-workspace";
import { DatasetWorkspace } from "./dataset-workspace";
import { ReportsWorkspace } from "./reports-workspace";

type Tab = "chat" | "reports" | "dataset";

const tabs: Array<{ id: Tab; label: string; icon: typeof MessageSquareText }> = [
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "reports", label: "Rapporter", icon: BarChart3 },
  { id: "dataset", label: "Datasett", icon: Database }
];

export function Workspace() {
  const [tab, setTab] = useState<Tab>("chat");
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(
    () => new Set(["chat"])
  );
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    chat: null,
    reports: null,
    dataset: null
  });

  function activateTab(nextTab: Tab) {
    setTab(nextTab);
    setVisitedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = tabs.findIndex((item) => item.id === tab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex].id;
    activateTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <>
      <header className="app-header flex items-center px-4 sm:px-6">
        <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center gap-2 text-xs font-medium text-white/80">
            <ShieldCheck size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Syntetiske demodata</span>
          </div>
          <strong className="text-[15px] tracking-wide">Norautron Analytics</strong>
          <div className="hidden justify-self-end text-xs text-white/75 sm:block">
            GPT-5.6-Terra
          </div>
        </div>
      </header>
      <main className="workspace">
        <nav
          className="workspace-nav"
          aria-label="Hovedområder"
          role="tablist"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              id={`tab-${id}`}
              type="button"
              role="tab"
              className="workspace-tab"
              data-active={tab === id}
              aria-controls={`panel-${id}`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => activateTab(id)}
              onKeyDown={handleTabKeyDown}
            >
              <span className="inline-flex items-center gap-2">
                <Icon size={16} aria-hidden="true" />
                {label}
              </span>
            </button>
          ))}
        </nav>
        {visitedTabs.has("chat") && (
          <section
            id="panel-chat"
            className="workspace-panel"
            role="tabpanel"
            aria-labelledby="tab-chat"
            hidden={tab !== "chat"}
          >
            <ChatWorkspace />
          </section>
        )}
        {visitedTabs.has("reports") && (
          <section
            id="panel-reports"
            className="workspace-panel"
            role="tabpanel"
            aria-labelledby="tab-reports"
            hidden={tab !== "reports"}
          >
            <ReportsWorkspace />
          </section>
        )}
        {visitedTabs.has("dataset") && (
          <section
            id="panel-dataset"
            className="workspace-panel"
            role="tabpanel"
            aria-labelledby="tab-dataset"
            hidden={tab !== "dataset"}
          >
            <DatasetWorkspace />
          </section>
        )}
      </main>
    </>
  );
}
