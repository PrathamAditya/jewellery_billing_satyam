import type { IntegrityResponse } from "@jewellery/shared";
import { api } from "../api";

/** Spec 052: runs the read-only data checks. Nothing is saved. */
export const runIntegrity = () => api<IntegrityResponse>("/api/integrity");
