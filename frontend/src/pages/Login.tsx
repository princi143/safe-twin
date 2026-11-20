import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, setToken, type User } from "../api";
import { Button } from "../components/ui";

/** Simple line drawing of the production cell for the sign-in screen. */
function CellArt() {
  const stations = [40, 150, 260, 370];
  return (
    <svg viewBox="0 0 460 300" className="w-full max-w-md" role="img" aria-label="Illustration of a production line">
      <rect x="20" y="210" width="420" height="14" rx="7" fill="#ffffff" opacity="0.35" />
      {stations.map((x, i) => (
        <g key={x}>
          <rect x={x} y={130 - (i % 2) * 22} width="70" height={80 + (i % 2) * 22} rx="10" fill="#ffffff" opacity={0.22 + i * 0.06} />
          <circle cx={x + 35} cy={170} r="16" fill="none" stroke="#ffffff" strokeWidth="5" opacity="0.9" />
          <circle cx={x + 35} cy={170} r="5" fill={i === 1 ? "#F2B8B8" : "#ffffff"} />
          <circle cx={x + 58} cy={118 - (i % 2) * 22} r="5" fill={i === 1 ? "#F2B8B8" : "#D8F3E6"} />
        </g>
      ))}
      {[118, 228, 338].map((x) => <rect key={x} x={x} y="199" width="14" height="10" rx="2" fill="#ffffff" opacity="0.8" />)}
      <path d="M60 70 Q230 10 400 70" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="4 7" opacity="0.6" />
      <circle cx="230" cy="40" r="20" fill="#ffffff" opacity="0.25" />
      <path d="M221 40 l6 6 12-13" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
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
      setError(msg.startsWith("Failed to fetch") || msg.startsWith("5") ? "Can't reach the backend. Check that it is running." : msg);
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-text outline-none focus:border-accent";
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col items-center justify-center gap-6 bg-gradient-to-br from-brand to-accent p-10 lg:flex">
        <CellArt />
        <p className="text-lg font-semibold text-white">See the failure before the line stops</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-brand">SAFE-TWIN</h1>
          <p className="mt-1 text-sm text-muted">Sign in to continue</p>
          <label className="mt-6 block text-xs text-muted">
            Username
            <input className={field} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label className="mt-3 block text-xs text-muted">
            Password
            <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="mt-3 text-xs text-high" role="alert">{error}</p>}
          <Button variant="primary" type="submit" disabled={busy || !username || !password} className="mt-6 w-full py-2.5 text-sm">
            <LogIn size={16} />{busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
