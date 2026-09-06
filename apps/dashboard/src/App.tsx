import { lazy, Suspense } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";

const EntityGraphPage = lazy(() => import("./pages/EntityGraphPage"));
const GoalsPage = lazy(() => import("./pages/GoalsPage"));
const PersonalHistoryPage = lazy(() => import("./pages/PersonalHistoryPage"));

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center bg-stone-950">
      <span className="font-serif text-sm italic text-stone-600">opening BODHI…</span>
    </div>
  );
}

/**
 * The dashboard remains a curation surface, not an execution harness. Entities
 * are canonical truth; Personal history makes imported evidence visible and
 * searchable without pretending each conversation is an entity or memory.
 */
export default function App() {
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-stone-950">
      <header className="flex h-11 flex-shrink-0 items-center justify-between border-b border-stone-800/50 px-4 sm:px-6">
        <span className="font-serif text-[14px] tracking-[0.01em] text-stone-400">BODHI</span>
        <nav aria-label="Admin sections" className="flex h-full items-center gap-5">
          {[
            ["/entities", "Entities"],
            ["/goals", "Goals"],
            ["/history", "Personal history"],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `relative flex h-full items-center font-mono text-[10px] tracking-[0.11em] transition-colors ${
                isActive ? "text-stone-100 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-accent-amber" : "text-stone-600 hover:text-stone-300"
              }`}
            >
              {label.toUpperCase()}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/entities" element={<EntityGraphPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/history" element={<PersonalHistoryPage />} />
              <Route path="/timeline" element={<Navigate to="/entities?view=timeline" replace />} />
              <Route path="*" element={<Navigate to="/entities" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </main>
  );
}
