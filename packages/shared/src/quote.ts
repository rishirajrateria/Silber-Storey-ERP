import { z } from 'zod';

export const QuoteItemSchema = z.object({
  key: z.string(), label: z.string(), qty: z.number().nonnegative(), unit: z.string(), rate: z.number().nonnegative(),
  rateOverridden: z.boolean().default(false), overrideRemark: z.string().optional(), amount: z.number().optional(),
});
export const QuoteServiceSchema = z.object({
  key: z.string(), label: z.string(), mode: z.enum(['fixed', 'pct']), value: z.number().nonnegative(), amount: z.number().optional(),
});
export const QuoteDataSchema = z.object({
  propertyType: z.enum(['1BHK', '2BHK', '3BHK', '4BHK', 'villa', 'office', 'retail']),
  carpetAreaSqft: z.number().positive(),
  locality: z.string().default(''),
  possession: z.enum(['ready', 'under_construction']),
  projectType: z.enum(['full', 'partial', 'renovation']),
  package: z.enum(['essential', 'premium', 'luxury']),
  rooms: z.array(z.object({ name: z.string(), items: z.array(QuoteItemSchema) })).default([]),
  services: z.array(QuoteServiceSchema).default([]),
  contingencyPct: z.number().min(0).max(100).default(0),
  discountType: z.enum(['amount', 'pct']).default('amount'),
  discountValue: z.number().min(0).default(0),
  roundOff: z.boolean().default(true),
});
export type QuoteData = z.infer<typeof QuoteDataSchema>;

export const PaymentScheduleSchema = z.array(z.object({
  name: z.string().min(1), pct: z.number().min(0).max(100), amount: z.number().optional(), trigger: z.string().default(''),
})).min(1);
export type PaymentSchedule = z.infer<typeof PaymentScheduleSchema>;

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface QuoteTotals {
  base: number; roomsTotal: number; servicesTotal: number; contingency: number; discount: number; subtotal: number;
  gstPct: number; gstAmount: number; total: number; roundOffAmount: number; data: QuoteData;
}

/** Deterministic server-side quote computation (Section 7). */
export function computeQuote(input: QuoteData, packageRate: number, gstPct: number): QuoteTotals {
  const data: QuoteData = JSON.parse(JSON.stringify(input));
  const base = r2(data.carpetAreaSqft * packageRate);
  let roomsTotal = 0;
  for (const room of data.rooms) for (const it of room.items) { it.amount = r2(it.qty * it.rate); roomsTotal += it.amount; }
  roomsTotal = r2(roomsTotal);
  const preServices = base + roomsTotal;
  let servicesTotal = 0;
  for (const s of data.services) { s.amount = r2(s.mode === 'pct' ? (preServices * s.value) / 100 : s.value); servicesTotal += s.amount; }
  servicesTotal = r2(servicesTotal);
  const beforeContingency = preServices + servicesTotal;
  const contingency = r2((beforeContingency * data.contingencyPct) / 100);
  const gross = beforeContingency + contingency;
  const discount = r2(data.discountType === 'pct' ? (gross * data.discountValue) / 100 : Math.min(data.discountValue, gross));
  const subtotal = r2(gross - discount);
  const gstAmount = r2((subtotal * gstPct) / 100);
  let total = r2(subtotal + gstAmount);
  let roundOffAmount = 0;
  if (data.roundOff) { const rounded = Math.round(total); roundOffAmount = r2(rounded - total); total = rounded; }
  return { base, roomsTotal, servicesTotal, contingency, discount, subtotal, gstPct, gstAmount, total, roundOffAmount, data };
}

export function scheduleSumsTo100(s: PaymentSchedule) {
  return Math.abs(s.reduce((a, m) => a + m.pct, 0) - 100) < 0.001;
}
