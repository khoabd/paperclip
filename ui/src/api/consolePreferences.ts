import { api } from "./client";

export type ConsoleLayout = Record<string, { x: number; y: number }>;

export const consolePreferencesApi = {
  get: (companyId: string) =>
    api.get<ConsoleLayout>(`/companies/${companyId}/console-layout`),
  save: (companyId: string, layout: ConsoleLayout) =>
    api.put<{ ok: boolean }>(`/companies/${companyId}/console-layout`, layout),
};
