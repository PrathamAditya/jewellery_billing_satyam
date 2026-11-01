import { useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH } from "@jewellery/shared";
import { ApiError, api } from "./api";
import { useAuth } from "./auth";
import { Alert, Field, btnPrimary, inputClass } from "./customers/ui";

/** Spec 004 R6: shown after a temporary password is set. Nothing else works until it is changed. */
export default function ForcePasswordChange() {
  const { refresh, logout, user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError("The two new passwords do not match.");
    setBusy(true);
    try {
      await api("/api/auth/change-password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-stone-200 rounded-xl shadow-sm p-6 flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Choose your own password</h1>
        <p className="text-sm text-stone-600">Hello {user?.displayName}. Your password was set by someone else. Choose a new one to continue.</p>
        <Field label="Temporary password"><input className={inputClass} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
        <Field label={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`}><input className={inputClass} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required /></Field>
        <Field label="Repeat the new password"><input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></Field>
        {error && <Alert>{error}</Alert>}
        <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Saving..." : "Save and continue"}</button>
        <button type="button" className="text-sm underline text-stone-600" onClick={() => void logout()}>Log out</button>
      </form>
    </main>
  );
}
