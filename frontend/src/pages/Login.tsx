import { useState, type FormEvent } from "react";
import { api, setToken, type User } from "../api";
import { Button } from "../components/ui";

export function Login({ onSignedIn, advisory }: { onSignedIn: (user: User) => void; advisory?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.login(username.trim(), password);
      setToken(res.token);
      onSignedIn(res.user);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.startsWith("Failed to fetch") || msg.startsWith("5") ? "Can't reach the SAFE-TWIN backend. Check that it is running." : msg);
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-1 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-text outline-none focus:border-accent";
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-panel p-6">
        <h1 className="text-xl font-semibold tracking-tight">SAFE-TWIN</h1>
        <p className="mt-1 text-xs text-muted">Sign in as an operator or a supervisor. Sign-in and sign-out times are recorded in the shift log.</p>
        <label className="mt-5 block text-xs text-muted">
          Username
          <input className={field} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label className="mt-3 block text-xs text-muted">
          Password
          <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="mt-3 text-xs text-high" role="alert">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy || !username || !password} className="mt-5 w-full py-2 text-sm">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {advisory && <p className="mt-5 border-t border-line pt-3 text-[11px] text-muted">{advisory}</p>}
      </form>
    </div>
  );
}
