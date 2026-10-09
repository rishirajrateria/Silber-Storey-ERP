export function renderTemplate(body: string, vars: Record<string, string | number | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));
}
