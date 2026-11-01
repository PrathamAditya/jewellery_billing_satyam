import { useEffect, useState } from "react";
import { PERMISSIONS, type Permission } from "@jewellery/shared";
import { ApiError } from "../api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { activityOf, createPerson, createRole, endSessions, listPeople, listRoles, resetPassword, updatePerson, updateRole, type PersonRow, type RoleRow } from "./api";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "never");
const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong");

function NewPersonDialog({ roles, onClose, onDone }: { roles: RoleRow[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ username: "", displayName: "", role: roles.find((r) => r.name === "staff")?.name ?? "staff", temporaryPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await createPerson({ ...v, username: v.username.trim().toLowerCase(), displayName: v.displayName.trim() });
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="New person" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Field label="Name *"><input className={inputClass} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} /></Field>
        <Field label="Username *" hint="Letters, digits, dot, dash or underscore"><input className={inputClass} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} autoComplete="off" /></Field>
        <Field label="Role *">
          <select className={inputClass} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
            {roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Temporary password *" hint="At least 10 characters. Tell the person; they must change it at first login.">
          <input className={inputClass} type="text" value={v.temporaryPassword} onChange={(e) => setV({ ...v, temporaryPassword: e.target.value })} autoComplete="off" />
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Saving..." : "Add person"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ActivityDialog({ person, onClose }: { person: PersonRow; onClose: () => void }) {
  const [items, setItems] = useState<{ action: string; entity: string; at: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    activityOf(person.id).then((r) => setItems(r.items)).catch((e) => setError(errText(e)));
  }, [person.id]);
  return (
    <Modal title={`Activity: ${person.displayName}`} onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      {!items && !error && <p className="text-stone-500">Loading...</p>}
      {items && items.length === 0 && <p className="text-stone-500">Nothing recorded yet.</p>}
      {items && items.length > 0 && (
        <ul className="text-sm flex flex-col gap-1 max-h-96 overflow-y-auto">
          {items.map((i, n) => (
            <li key={n}>
              <span className="text-stone-500">{when(i.at)}</span> · {i.action.replace(/_/g, " ")} ({i.entity})
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-500">Shows what was done and when. It never shows the values that were typed.</p>
    </Modal>
  );
}

function ResetDialog({ person, onClose, onDone }: { person: PersonRow; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`New temporary password for ${person.displayName}`} onClose={onClose}>
      <p className="text-sm text-stone-600">Their current sessions end and they must choose a new password at the next login.</p>
      <Field label="Temporary password (at least 10 characters)"><input className={inputClass} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2 justify-end">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} onClick={() => resetPassword(person.id, pw).then(onDone).catch((e) => setError(errText(e)))}>Set temporary password</button>
      </div>
    </Modal>
  );
}

function PeopleTab({ roles, me }: { roles: RoleRow[]; me: string }) {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [activity, setActivity] = useState<PersonRow | null>(null);
  const [resetting, setResetting] = useState<PersonRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => listPeople().then((r) => setPeople(r.items)).catch((e) => setError(errText(e)));
  useEffect(() => void load(), []);

  async function act(fn: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center gap-2">
        <p className="text-sm text-stone-600">Each person logs in with their own account. Changes apply on their next request.</p>
        <button className={btnPrimary} onClick={() => setAdding(true)}>New person</button>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="ok">{notice}</Alert>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Last login</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{p.displayName}</div>
                  <div className="text-stone-500">{p.username}</div>
                </td>
                <td className="px-3 py-2">
                  <select className="border border-stone-300 rounded px-2 py-1" value={p.role} aria-label={`Role of ${p.displayName}`} onChange={(e) => void act(() => updatePerson(p.id, { role: e.target.value }), `Role changed for ${p.displayName}.`)}>
                    {roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {p.disabled ? <span className="text-red-700">Disabled</span> : p.mustChangePassword ? <span className="text-amber-800">Must change password</span> : <span className="text-green-700">Active</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{when(p.lastLoginAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button className="underline" onClick={() => setActivity(p)}>Activity</button>
                    <button className="underline" onClick={() => setResetting(p)}>Reset password</button>
                    <button className="underline" onClick={() => void act(() => endSessions(p.id), `${p.displayName} is logged out everywhere.`)}>Log out everywhere</button>
                    {p.id !== me && (
                      <button className="underline" onClick={() => void act(() => updatePerson(p.id, { disabled: !p.disabled }), p.disabled ? `${p.displayName} is enabled.` : `${p.displayName} is disabled and logged out.`)}>
                        {p.disabled ? "Enable" : "Disable"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <NewPersonDialog roles={roles} onClose={() => setAdding(false)} onDone={() => (setAdding(false), setNotice("Person added. Give them the temporary password."), void load())} />}
      {activity && <ActivityDialog person={activity} onClose={() => setActivity(null)} />}
      {resetting && <ResetDialog person={resetting} onClose={() => setResetting(null)} onDone={() => (setResetting(null), setNotice("Temporary password set."), void load())} />}
    </div>
  );
}

function RoleEditor({ role, onSaved }: { role: RoleRow; onSaved: () => void }) {
  const [perms, setPerms] = useState<string[]>(role.permissions);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const toggle = (p: string) => setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  async function save() {
    setError(null);
    setSaved(false);
    try {
      await updateRole(role.name, { permissions: perms as Permission[] });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errText(e));
    }
  }
  return (
    <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
      <h3 className="font-semibold">{role.label} <span className="text-xs font-normal text-stone-500">({role.name})</span></h3>
      {role.system && <p className="text-sm text-stone-600">The owner role always has every permission.</p>}
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        {PERMISSIONS.map((p) => (
          <label key={p} className="flex items-center gap-2">
            <input type="checkbox" disabled={role.system} checked={perms.includes(p)} onChange={() => toggle(p)} />
            {p}
          </label>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="ok">Saved.</Alert>}
      {!role.system && <div><button className={btnPrimary} onClick={() => void save()}>Save role</button></div>}
    </section>
  );
}

function RolesTab({ roles, reload }: { roles: RoleRow[]; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setError(null);
    try {
      await createRole({ name: name.trim().toLowerCase(), label: label.trim(), permissions: perms as Permission[] });
      setAdding(false);
      setName("");
      setLabel("");
      setPerms([]);
      reload();
    } catch (e) {
      setError(errText(e));
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-stone-600">Tick what each role may do. People get the change on their next request.</p>
        <button className={btnSecondary} onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "New role"}</button>
      </div>
      {adding && (
        <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Short name (letters, digits)"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Name shown to people"><input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          </div>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input type="checkbox" checked={perms.includes(p)} onChange={() => setPerms((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]))} />
                {p}
              </label>
            ))}
          </div>
          {error && <Alert>{error}</Alert>}
          <div><button className={btnPrimary} onClick={() => void create()}>Create role</button></div>
        </section>
      )}
      {roles.map((r) => <RoleEditor key={r.name} role={r} onSaved={reload} />)}
    </div>
  );
}

export default function UsersPage({ me }: { me: string }) {
  const [tab, setTab] = useState<"people" | "roles">("people");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loadRoles = () => listRoles().then((r) => setRoles(r.items)).catch((e) => setError(errText(e)));
  useEffect(() => void loadRoles(), []);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">People and roles</h1>
      {error && <Alert>{error}</Alert>}
      <nav className="flex gap-1 border-b border-stone-200" aria-label="People tabs">
        {(["people", "roles"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`px-3 py-2 text-sm border-b-2 ${tab === t ? "border-stone-900 font-medium" : "border-transparent text-stone-500"}`}>
            {t === "people" ? "People" : "Roles"}
          </button>
        ))}
      </nav>
      {tab === "people" ? <PeopleTab roles={roles} me={me} /> : <RolesTab roles={roles} reload={loadRoles} />}
    </div>
  );
}
