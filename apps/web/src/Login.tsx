import { useState, type FormEvent } from "react";
import { ApiError } from "./api";
import { useAuth } from "./auth";

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Too many attempts. Please try again in 15 minutes.";
    if (e.status === 401) return e.body.message ?? "Invalid username or password";
    return e.message;
  }
  return "Something went wrong. Please try again.";
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(messageFor(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-stone-200 rounded-xl shadow-sm p-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Jewellery Billing</h1>
        <p className="text-stone-600 text-sm -mt-2">Log in to continue</p>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Username
          <input
            className="border border-stone-300 rounded-lg px-3 py-2 text-base font-normal"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            className="border border-stone-300 rounded-lg px-3 py-2 text-base font-normal"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-stone-900 text-white rounded-lg py-2.5 font-medium disabled:opacity-60"
        >
          {busy ? "Logging in..." : "Log in"}
        </button>
      </form>
    </main>
  );
}
