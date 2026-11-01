import { useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH } from "@jewellery/shared";
import { ApiError, api } from "./api";
import { useAuth } from "./auth";

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    try {
      await api("/api/auth/change-password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "border border-stone-300 rounded-lg px-3 py-2 text-base font-normal";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20" role="dialog" aria-modal="true" aria-label="Change password">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-xl shadow-lg p-6 flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Change password</h2>
        {done ? (
          <>
            <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Password changed. Other devices were logged out.
            </p>
            <button type="button" onClick={onClose} className="bg-stone-900 text-white rounded-lg py-2.5 font-medium">
              Close
            </button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Current password
              <input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              New password (at least {MIN_PASSWORD_LENGTH} characters)
              <input className={input} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Confirm new password
              <input className={input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-stone-300">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-stone-900 text-white font-medium disabled:opacity-60">
                {busy ? "Saving..." : "Change password"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

export default function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="font-medium">{user?.displayName ?? user?.username}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-48 bg-white border border-stone-200 rounded-lg shadow-lg py-1 z-10">
          <button
            role="menuitem"
            className="w-full text-left px-4 py-2 text-sm hover:bg-stone-100"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
          >
            Change password
          </button>
          <button role="menuitem" className="w-full text-left px-4 py-2 text-sm hover:bg-stone-100" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      )}
      {changing && <ChangePassword onClose={() => setChanging(false)} />}
    </div>
  );
}
