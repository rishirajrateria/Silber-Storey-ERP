export const ROLES = ['admin', 'sales', 'engineer', 'finance', 'design_head', 'junior_designer'] as const;
export type Role = (typeof ROLES)[number];

export const DASHBOARDS = ['sales', 'engineer', 'finance', 'design_head', 'junior_designer', 'global'] as const;
export type Dashboard = (typeof DASHBOARDS)[number];

export const STAGES = [
  'lead_received', 'qualified_by_sales', 'transferred_to_engineer', 'first_contact', 'meeting_scheduled', 'meeting_done',
  'quote_v1', 'admin_approved', 'quote_sent', 'client_accepted_final', 'pushed_to_finance', 'invoice_sent', 'advance_paid',
  'pushed_to_design', 'internal_meeting_done', 'second_client_meeting_done', 'handover_accepted',
] as const;
export type Stage = (typeof STAGES)[number];
export const stageIndex = (s: Stage) => STAGES.indexOf(s);

export const SALES_STATUS_KEYS = ['no_status', 'contacted_text', 'contacted_call', 'seems_positive', 'transferred', 'lost'] as const;
export const ENGINEER_STATUS_KEYS = [
  'contacted_no_response', 'call_later', 'in_pipeline', 'meeting_set', 'asked_quote', 'quote_waiting_approval', 'quote_sent',
  'multiple_quotes_sent', 'quote_approved_payment', 'pushed_to_finance', 'advance_paid', 'pushed_to_design', 'handover_complete', 'lost',
] as const;

export const APPROVAL_TYPES = ['duplicate_override', 'quote_version', 'milestone_pct_change', 'credit_note', 'invoice_cancellation', 'new_user', 'meeting_invite'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const MEETING_KINDS = ['client', 'internal', 'second_client'] as const;
export const MEETING_TYPES = ['meet', 'office', 'site'] as const;
export const MEETING_STATUSES = ['scheduled', 'rescheduled', 'cancelled', 'in_progress', 'completed', 'no_show'] as const;
export const PRIORITIES = ['low', 'med', 'high'] as const;
export const CHANNELS = ['email', 'whatsapp', 'sms', 'manual_call', 'manual_whatsapp', 'manual_email'] as const;
export const PAYMENT_MODES = ['upi', 'neft', 'cheque', 'cash', 'other'] as const;

export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin', sales: '/sales', engineer: '/engineer', finance: '/finance', design_head: '/design', junior_designer: '/design',
};
