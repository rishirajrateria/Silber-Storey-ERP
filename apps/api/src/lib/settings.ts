import { prisma } from './db.js';
import { DEFAULT_RATE_CARD } from '@app/shared';
import { config } from '../config.js';

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  gstPct: 18,
  hsnSac: '998391',
  invoiceSeries: 'INV',
  receiptSeries: 'RCP',
  creditNoteSeries: 'CN',
  fyResetMonth: 4,
  quoteValidityDays: 15,
  quietHours: { start: '21:00', end: '08:00' },
  officeAddress: config.office.address,
  officeLat: config.office.lat,
  officeLng: config.office.lng,
  checkinRadiusM: 200,
  branding: {
    logo: '', colors: { primary: '#5EE6FF' }, companyName: 'Silber Storey Interiors', address: config.office.address,
    gstin: '27AAAAA0000A1Z5', state: 'Maharashtra', phone: '+919999999999', email: 'hello@example.com',
  },
  inclusionsText: 'Design consultation, 3D renders, material as per package, installation and site supervision.',
  exclusionsText: 'Civil structural changes, appliances, government approvals, anything not listed in scope.',
  termsText: 'Quote valid for the stated validity period. Payments as per schedule. GST extra as applicable.',
  rateCard: DEFAULT_RATE_CARD,
  caps: {},
  stageThresholdDays: Object.fromEntries(['lead_received','qualified_by_sales','transferred_to_engineer','first_contact','meeting_scheduled','meeting_done','quote_v1','admin_approved','quote_sent','client_accepted_final','pushed_to_finance','invoice_sent','advance_paid','pushed_to_design','internal_meeting_done','second_client_meeting_done'].map((s) => [s, 3])),
};

const cache = new Map<string, unknown>();
let loaded = false;

export async function loadSettings() {
  const rows = await prisma.setting.findMany();
  cache.clear();
  for (const r of rows) cache.set(r.key, r.value);
  loaded = true;
}
export async function getSetting<T = unknown>(key: string): Promise<T> {
  if (!loaded) await loadSettings();
  return (cache.has(key) ? cache.get(key) : DEFAULT_SETTINGS[key]) as T;
}
export async function getAllSettings() {
  if (!loaded) await loadSettings();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of cache) out[k] = v;
  return out;
}
export async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } });
  cache.set(key, value);
}
export function invalidateSettings() { loaded = false; }
