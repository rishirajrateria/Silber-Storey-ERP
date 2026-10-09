import { z } from 'zod';
import { CHANNELS, MEETING_KINDS, MEETING_TYPES, PAYMENT_MODES, PRIORITIES, ROLES } from './enums.js';

export const phoneSchema = z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Phone must be 10–15 digits');

export const CreateLeadSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(1).optional(),
  locationArea: z.string().optional(),
  ethnicity: z.string().optional(),
  gender: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  requirement: z.string().optional(),
  sourceId: z.string(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;

export const PatchLeadSchema = z.object({
  budget: z.number().nonnegative().nullable().optional(),
  name: z.string().optional(),
  exactAddress: z.string().optional(),
  gender: z.string().optional(),
  requirement: z.string().optional(),
});

export const BillingSchema = z.object({
  legalName: z.string().min(1), billingAddress: z.string().min(1), state: z.string().min(1), gstin: z.string().optional(),
  pan: z.string().optional(), siteAddress: z.string().min(1), contactName: z.string().min(1), contactPhone: phoneSchema, contactEmail: z.string().email(),
});

export const StatusChangeSchema = z.object({
  statusId: z.string(), reason: z.string().optional(), followUpAt: z.string().datetime().optional(), priority: z.enum(PRIORITIES).optional(),
});

export const LogContactSchema = z.object({ channel: z.enum(CHANNELS), note: z.string().min(1) });

export const CreateMeetingSchema = z.object({
  leadId: z.string(), kind: z.enum(MEETING_KINDS), type: z.enum(MEETING_TYPES), startAt: z.string().datetime(), endAt: z.string().datetime(),
  adminInvited: z.boolean().default(false), attendeeUserIds: z.array(z.string()).optional(),
});

export const PaymentSchema = z.object({
  amount: z.number().positive(), mode: z.enum(PAYMENT_MODES), reference: z.string().optional(), paidOn: z.string().datetime(),
});

export const CreateUserSchema = z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(ROLES) });
