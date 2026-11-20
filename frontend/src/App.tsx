import { useCallback, useEffect, useState } from "react";
import { api, connectLive, hasToken, onSessionExpired, setToken, type Factory, type Health, type LiveMachine, type Sample, type User } from "./api";
import { Badge, Button } from "./components/ui";
import { Login } from "./pages/Login";
import { OperatorPage } from "./pages/OperatorPage";
import { SupervisorPage } from "./pages/SupervisorPage";

const MAX_SAMPLES = 150;
type Page = "floor" | "supervisor";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(hasToken());
  const [page, setPage] = useState<Page>("floor");
  const [health, setHealth] = useState<Health | null>(null);
  const [factory, setFactory] = useState<Factory | null>(null);
  const [live, setLive] = useState<Record<string, LiveMachine>>({});
  const [history, setHistory] = useState<Record<string, Sample[]>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  // Restore the session of this browser tab, if there is one.
  useEffect(() => {
    onSessionExpired(() => setUser(null));
    if (!hasToken()) return;
    api.me().then((u) => { setUser(u); setPage(u.role === "supervisor" ? "supervisor" : "floor"); })
      .catch(() => setToken("")).finally(() => setChecking(false));
  }, []);

  const loadHistory = useCallback(async (machines: { id: string }[]) => {
    const all = await Promise.all(machines.map((m) => api.telemetry(m.id)));
    setHistory(Object.fromEntries(machines.map((m, i) => [m.id, all[i]])));
  }, []);

  // Cell layout and model details, retried until the backend answers.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [h, f] = await Promise.all([api.health(), api.factory()]);
        if (stop) return;
        setHealth(h); setFactory(f); setError("");
        await loadHistory(f.machines);
      } catch {
        if (stop) return;
        setError("Can't reach the SAFE-TWIN backend yet. If it is starting or waking up, this page will connect by itself.");
        setTimeout(load, 3000);
      }
    };
    load();
    return () => { stop = true; };
  }, [loadHistory]);

  // Live telemetry stream.
  useEffect(() => connectLive((snap) => {
    setLive(Object.fromEntries(snap.machines.map((m) => [m.id, m])));
    setHistory((prev) => {
      const next = { ...prev };
      for (const m of snap.machines) {
        const list = prev[m.id] ?? [];
        if (list.length && list[list.length - 1].ts === m.ts) continue;
        next[m.id] = [...list, { ts: m.ts, vibration: m.vibration, temperature: m.temperature, current: m.current, risk: m.risk }].slice(-MAX_SAMPLES);
      }
      return next;
    });
  }, setConnected), []);

  const signOut = async () => {
    try { await api.logout(); } catch { /* the token may already have expired */ }
    setToken("");
    setUser(null);
    setPage("floor");
  };

  if (checking) return null;
  if (!user) {
    return (
      <>
        {error && <p className="m-4 rounded-md border border-high/40 bg-high/10 px-3 py-2 text-xs text-high" role="alert">{error}</p>}
        <Login onSignedIn={(u) => { setUser(u); setPage(u.role === "supervisor" ? "supervisor" : "floor"); }} advisory={health?.advisory} />
      </>
    );
  }

  const tab = (p: Page, label: string) => (
    <button onClick={() => setPage(p)} aria-current={page === p ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${page === p ? "bg-raised text-text" : "text-muted hover:text-text"}`}>
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">SAFE-TWIN</h1>
            <p className="text-xs text-muted">Factory-level failure impact and decision support · virtual production cell</p>
          </div>
          <nav className="flex gap-1 rounded-lg border border-line bg-panel p-1" aria-label="Pages">
            {tab("floor", "Factory floor")}
            {user.role === "supervisor" && tab("supervisor", "Supervisor")}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={connected ? "#3fb68b" : "#ef5b5b"}>{connected ? "live" : "offline"}</Badge>
          {health && (
            <span title={health.store_note}>
              <Badge color={health.store === "supabase" ? "#3fb68b" : "#e2a93b"}>
                {health.store === "supabase" ? "Supabase connected" : "demo data · not saved"}
              </Badge>
            </span>
          )}
          <span className="text-xs text-muted">{user.username} · {user.role}</span>
          <Button onClick={signOut}>Sign out</Button>
        </div>
      </header>

      {error && <p className="rounded-md border border-high/40 bg-high/10 px-3 py-2 text-xs text-high" role="alert">{error}</p>}
      {health?.store === "memory" && (
        <p className="rounded-md border border-watch/40 bg-watch/10 px-3 py-2 text-xs text-watch">{health.store_note}</p>
      )}

      {factory && page === "floor" && (
        <OperatorPage user={user} health={health} factory={factory} live={live} history={history} connected={connected}
          onReset={() => loadHistory(factory.machines)} />
      )}
      {factory && page === "supervisor" && user.role === "supervisor" && <SupervisorPage factory={factory} live={live} />}

      <footer className="pb-4 text-center text-[11px] text-muted">{health?.advisory}</footer>
    </div>
  );
}
