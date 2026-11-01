import type { Permission } from "@jewellery/shared";
import { api } from "../api";

export type PersonRow = { id: string; username: string; displayName: string; role: string; disabled: boolean; lastLoginAt: string | null; mustChangePassword: boolean };
export type RoleRow = { name: string; label: string; permissions: string[]; system: boolean };

export const listPeople = () => api<{ items: PersonRow[] }>("/api/users");
export const createPerson = (body: { username: string; displayName: string; role: string; temporaryPassword: string }) =>
  api<PersonRow>("/api/users", { method: "POST", body });
export const updatePerson = (id: string, body: { role?: string; disabled?: boolean; displayName?: string }) =>
  api<PersonRow>(`/api/users/${id}`, { method: "PATCH", body });
export const resetPassword = (id: string, temporaryPassword: string) =>
  api<{ ok: boolean }>(`/api/users/${id}/reset-password`, { method: "POST", body: { temporaryPassword } });
export const endSessions = (id: string) => api<{ ok: boolean }>(`/api/users/${id}/end-sessions`, { method: "POST" });
export const activityOf = (id: string) => api<{ items: { action: string; entity: string; entityId: string; at: string }[]; nextCursor: string | null }>(`/api/users/${id}/activity`);

export const listRoles = () => api<{ items: RoleRow[] }>("/api/roles");
export const createRole = (body: { name: string; label: string; permissions: Permission[] }) => api<RoleRow>("/api/roles", { method: "POST", body });
export const updateRole = (name: string, body: { label?: string; permissions?: Permission[] }) => api<RoleRow>(`/api/roles/${name}`, { method: "PATCH", body });
