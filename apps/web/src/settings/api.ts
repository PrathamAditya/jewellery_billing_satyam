import type { SettingsKey, SettingsSnapshot } from "@jewellery/shared";
import { api } from "../api";

export const getSettings = () => api<SettingsSnapshot>("/api/settings");
export const putSetting = <K extends SettingsKey>(key: K, value: SettingsSnapshot[K]) =>
  api<SettingsSnapshot[K]>(`/api/settings/${key}`, { method: "PUT", body: value });
export const getNumbering = () =>
  api<{ items: { series: string; fy: string; last_no: number }[] }>("/api/settings/numbering");
export const setNextNumber = (series: string, fy: string, nextNumber: number) =>
  api<{ series: string; fy: string; nextNumber: number }>("/api/settings/next-number", {
    method: "POST",
    body: { series, fy, nextNumber },
  });
