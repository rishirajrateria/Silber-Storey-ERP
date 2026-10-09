export const DELAY_RULES = [
  { dashboard: 'sales', ruleKey: 'lead_not_contacted', thresholdHours: 24 },
  { dashboard: 'sales', ruleKey: 'followup_overdue', thresholdHours: 48 },
  { dashboard: 'engineer', ruleKey: 'no_first_contact_after_transfer', thresholdHours: 24 },
  { dashboard: 'engineer', ruleKey: 'followup_overdue', thresholdHours: 48 },
  { dashboard: 'engineer', ruleKey: 'meeting_done_no_quote', thresholdHours: 72 },
  { dashboard: 'engineer', ruleKey: 'billing_missing_after_acceptance', thresholdHours: 48 },
  { dashboard: 'admin', ruleKey: 'quote_approval_pending', thresholdHours: 48 },
  { dashboard: 'admin', ruleKey: 'approval_pending_any', thresholdHours: 48 },
  { dashboard: 'finance', ruleKey: 'invoice_not_sent_after_push', thresholdHours: 24 },
  { dashboard: 'finance', ruleKey: 'invoice_unpaid', thresholdHours: 168 },
  { dashboard: 'design_head', ruleKey: 'junior_not_assigned', thresholdHours: 48 },
  { dashboard: 'all', ruleKey: 'handover_acceptance_pending', thresholdHours: 72 },
] as const;

export const NOTIFICATION_EVENTS = [
  'lead_assigned', 'followup_due', 'followup_overdue', 'meeting_scheduled', 'meeting_reminder', 'meeting_rescheduled', 'meeting_cancelled',
  'admin_invite', 'admin_invite_response', 'consent_accepted', 'invite_accepted', 'mom_ready', 'objection_raised', 'quote_approval_requested',
  'quote_approved', 'quote_rejected', 'quote_sent', 'quote_accepted', 'quote_change_requested', 'pushed_to_finance', 'pct_change_requested',
  'pct_change_decided', 'invoice_sent', 'invoice_paid', 'receipt_sent', 'credit_note_requested', 'credit_note_decided', 'pushed_to_design',
  'junior_assigned', 'handover_accepted', 'handover_complete', 'delay_breached', 'new_user_requested', 'duplicate_override_requested',
  'duplicate_override_decided', 'digest',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const CLIENT_TEMPLATE_KEYS = [
  'meeting_invite', 'meeting_reminder', 'meeting_rescheduled', 'meeting_cancelled', 'mom_email', 'quote_link', 'invoice_link', 'invoice_pdf', 'receipt_thankyou',
] as const;

export const TEMPLATE_VARIABLES = [
  'client_name', 'company', 'meeting_datetime', 'meeting_type', 'meet_link', 'office_directions', 'invite_link', 'consent_link', 'quote_link',
  'quote_total', 'invoice_number', 'invoice_link', 'amount', 'receipt_link',
] as const;

export const REPORT_KEYS = [
  'leads_by_source', 'leads_by_status', 'contact_rate', 'qualification_rate', 'meetings_summary', 'meeting_to_quote', 'quote_to_acceptance',
  'approval_turnaround', 'invoice_to_payment', 'outstanding_ageing', 'sla_breaches', 'user_performance', 'collections_by_month',
] as const;

export const DEFAULT_RATE_CARD = {
  packages: { essential: 1200, premium: 1800, luxury: 2600 },
  items: [
    { key: 'modular_kitchen', label: 'Modular kitchen', unit: 'rft', rate: 1800, group: 'kitchen' },
    { key: 'wardrobe', label: 'Wardrobe', unit: 'rft', rate: 1500, group: 'bedroom' },
    { key: 'tv_unit', label: 'TV unit', unit: 'unit', rate: 25000, group: 'living' },
    { key: 'false_ceiling', label: 'False ceiling', unit: 'sqft', rate: 110, group: 'general' },
    { key: 'electrical', label: 'Electrical', unit: 'point', rate: 650, group: 'general' },
    { key: 'painting', label: 'Painting', unit: 'sqft', rate: 28, group: 'general' },
    { key: 'loose_furniture', label: 'Loose furniture', unit: 'unit', rate: 18000, group: 'general' },
    { key: 'soft_furnishing', label: 'Soft furnishing', unit: 'unit', rate: 6000, group: 'general' },
    { key: 'bathroom_vanity', label: 'Bathroom vanity', unit: 'unit', rate: 22000, group: 'bathroom' },
    { key: 'study_unit', label: 'Study unit', unit: 'unit', rate: 20000, group: 'bedroom' },
  ],
  services: [
    { key: 'design_fee', label: 'Design fee', defaultMode: 'pct', defaultValue: 8 },
    { key: 'site_supervision', label: 'Site supervision', defaultMode: 'pct', defaultValue: 5 },
    { key: 'renders_3d', label: '3D renders', defaultMode: 'fixed', defaultValue: 25000 },
    { key: 'civil_allowance', label: 'Civil allowance', defaultMode: 'fixed', defaultValue: 50000 },
    { key: 'plumbing_allowance', label: 'Plumbing allowance', defaultMode: 'fixed', defaultValue: 30000 },
  ],
};
export type RateCard = typeof DEFAULT_RATE_CARD;
