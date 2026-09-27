export interface Finding { path: string; line: number; rule: string; why: string }
export const FORBIDDEN_PATHS: { re: RegExp; why: string }[];
export const CONTENT_RULES: { id: string; re: RegExp; allow?: RegExp; why: string }[];
export function checkPath(path: string): Finding[];
export function scanText(path: string, text: string, denylist?: string[]): Finding[];
export function checkSampleData(path: string, text: string): Finding[];
export function scanRepo(opts?: { staged?: boolean }): { files: number; findings: Finding[] };
