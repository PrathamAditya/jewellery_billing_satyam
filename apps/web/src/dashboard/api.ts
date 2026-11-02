import type { DashboardResponse } from "@jewellery/shared";
import { api } from "../api";

/** Spec 030: read-only. */
export const getDashboard = () => api<DashboardResponse>("/api/dashboard");
