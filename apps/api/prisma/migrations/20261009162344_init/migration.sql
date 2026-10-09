-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'sales', 'engineer', 'finance', 'design_head', 'junior_designer');

-- CreateEnum
CREATE TYPE "Dashboard" AS ENUM ('sales', 'engineer', 'finance', 'design_head', 'junior_designer', 'global');

-- CreateEnum
CREATE TYPE "PermLevel" AS ENUM ('none', 'read', 'full');

-- CreateEnum
CREATE TYPE "StatusDashboard" AS ENUM ('sales', 'engineer');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'med', 'high');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('lead_received', 'qualified_by_sales', 'transferred_to_engineer', 'first_contact', 'meeting_scheduled', 'meeting_done', 'quote_v1', 'admin_approved', 'quote_sent', 'client_accepted_final', 'pushed_to_finance', 'invoice_sent', 'advance_paid', 'pushed_to_design', 'internal_meeting_done', 'second_client_meeting_done', 'handover_accepted');

-- CreateEnum
CREATE TYPE "MeetingKind" AS ENUM ('client', 'internal', 'second_client');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('meet', 'office', 'site');

-- CreateEnum
CREATE TYPE "AdminResponse" AS ENUM ('none', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "AdminDecision" AS ENUM ('proceed', 'reschedule');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'rescheduled', 'cancelled', 'in_progress', 'completed', 'no_show');

-- CreateEnum
CREATE TYPE "RecordingSource" AS ENUM ('mic', 'bot');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('uploading', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('duplicate_override', 'quote_version', 'milestone_pct_change', 'credit_note', 'new_user', 'meeting_invite');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "QuoteApprovalStatus" AS ENUM ('not_required', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('pending', 'invoiced', 'paid');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'partially_paid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('upi', 'neft', 'cheque', 'cash', 'other');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('email', 'whatsapp', 'sms', 'manual_call', 'manual_whatsapp', 'manual_email');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('out', 'manual');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'logged');

-- CreateEnum
CREATE TYPE "TemplateChannel" AS ENUM ('email', 'whatsapp', 'sms', 'pdf');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "googleRefreshTokenEnc" TEXT,
    "calendarId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastLocAt" TIMESTAMP(3),
    "locationConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPermission" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "dashboard" "Dashboard" NOT NULL,
    "level" "PermLevel" NOT NULL DEFAULT 'none',
    "canApprove" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdminPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "ethnicity" TEXT,
    "gender" TEXT,
    "locationArea" TEXT,
    "exactAddress" TEXT,
    "addressLat" DOUBLE PRECISION,
    "addressLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "previousLeadId" TEXT,
    "source" TEXT NOT NULL,
    "requirement" TEXT,
    "leadDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "salesStatusId" TEXT NOT NULL,
    "engineerStatusId" TEXT,
    "genuine" BOOLEAN NOT NULL DEFAULT false,
    "budget" DOUBLE PRECISION,
    "salesUserId" TEXT NOT NULL,
    "engineerUserId" TEXT,
    "financeUserId" TEXT,
    "designHeadUserId" TEXT,
    "juniorUserId" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'lead_received',
    "transferredToEngineerAt" TIMESTAMP(3),
    "pushedToFinanceAt" TIMESTAMP(3),
    "pushedToDesignAt" TIMESTAMP(3),
    "handoverCompletedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "lostByRole" "Role",
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "projectClosedAt" TIMESTAMP(3),
    "recordingsKept" BOOLEAN,
    "aiProfile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingDetails" (
    "leadId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "billingAddress" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "siteAddress" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,

    CONSTRAINT "BillingDetails_pkey" PRIMARY KEY ("leadId")
);

-- CreateTable
CREATE TABLE "LeadStatus" (
    "id" TEXT NOT NULL,
    "dashboard" "StatusDashboard" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "requiresFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeadStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dashboard" TEXT NOT NULL,
    "fromStatusId" TEXT,
    "toStatusId" TEXT NOT NULL,
    "reason" TEXT,
    "followUpAt" TIMESTAMP(3),
    "priority" "Priority",
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" "Priority" NOT NULL,
    "calendarEventId" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" "MeetingKind" NOT NULL,
    "type" "MeetingType" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "engineerUserId" TEXT NOT NULL,
    "attendeeUserIds" TEXT[],
    "adminInvited" BOOLEAN NOT NULL DEFAULT false,
    "adminResponse" "AdminResponse" NOT NULL DEFAULT 'none',
    "adminRemark" TEXT,
    "adminDecision" "AdminDecision",
    "meetLink" TEXT,
    "calendarEventIds" JSONB NOT NULL DEFAULT '{}',
    "inviteToken" TEXT NOT NULL,
    "consentToken" TEXT NOT NULL,
    "inviteAcceptedAt" TIMESTAMP(3),
    "consentAcceptedAt" TIMESTAMP(3),
    "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled',
    "travelStartedAt" TIMESTAMP(3),
    "checkinAt" TIMESTAMP(3),
    "checkinLat" DOUBLE PRECISION,
    "checkinLng" DOUBLE PRECISION,
    "checkinDistanceM" DOUBLE PRECISION,
    "durationSec" INTEGER,
    "noShowMarkedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "source" "RecordingSource" NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "status" "RecordingStatus" NOT NULL DEFAULT 'uploading',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinutesOfMeeting" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "emailedToClientAt" TIMESTAMP(3),
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinutesOfMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objection" (
    "id" TEXT NOT NULL,
    "momId" TEXT NOT NULL,
    "remark" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL,

    CONSTRAINT "Objection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "meetingId" TEXT,
    "text" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFile" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "currentVersionNo" INTEGER NOT NULL DEFAULT 0,
    "finalVersionId" TEXT,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteVersion" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "gstPct" DOUBLE PRECISION NOT NULL,
    "gstAmount" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "paymentSchedule" JSONB NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL,
    "approvalStatus" "QuoteApprovalStatus" NOT NULL DEFAULT 'not_required',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalRemark" TEXT,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "sentToClientAt" TIMESTAMP(3),
    "clientToken" TEXT NOT NULL,
    "clientAcceptedAt" TIMESTAMP(3),
    "clientChangeRequest" TEXT,
    "text" TEXT NOT NULL,
    "pdfKey" TEXT,
    "diffFromPrevious" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPipeline" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,

    CONSTRAINT "PaymentPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "pct" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3),
    "invoiceId" TEXT,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER,
    "fullNumber" TEXT,
    "type" TEXT NOT NULL DEFAULT 'tax',
    "issueDate" TIMESTAMP(3),
    "lines" JSONB NOT NULL,
    "placeOfSupplyState" TEXT NOT NULL,
    "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstPct" DOUBLE PRECISION NOT NULL,
    "hsnSac" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "pdfKey" TEXT,
    "clientToken" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "fullNumber" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "pdfKey" TEXT,
    "clientToken" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "pdfKey" TEXT,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "leadId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "channel" "Channel" NOT NULL,
    "direction" "Direction" NOT NULL DEFAULT 'out',
    "templateKey" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "byUserId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "attachmentKey" TEXT,
    "holdUntil" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "channel" "TemplateChannel" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "providerStatus" "ProviderStatus",
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handover" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "designHeadUserId" TEXT NOT NULL,
    "juniorUserId" TEXT,
    "internalMeetingId" TEXT,
    "secondMeetingId" TEXT,
    "acceptedByEngineerAt" TIMESTAMP(3),
    "acceptedByHeadAt" TIMESTAMP(3),
    "acceptedByJuniorAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delay" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dashboard" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "thresholdHours" INTEGER NOT NULL,
    "breachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "Delay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelayRule" (
    "id" TEXT NOT NULL,
    "dashboard" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "thresholdHours" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DelayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "dashboard" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "timingOffsetsMin" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "dashboard" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "recipients" TEXT[],
    "reportKeys" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPermission_adminUserId_dashboard_key" ON "AdminPermission"("adminUserId", "dashboard");

-- CreateIndex
CREATE UNIQUE INDEX "Client_phone_key" ON "Client"("phone");

-- CreateIndex
CREATE INDEX "Lead_salesUserId_idx" ON "Lead"("salesUserId");

-- CreateIndex
CREATE INDEX "Lead_engineerUserId_idx" ON "Lead"("engineerUserId");

-- CreateIndex
CREATE INDEX "Lead_stage_idx" ON "Lead"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStatus_dashboard_key_key" ON "LeadStatus"("dashboard", "key");

-- CreateIndex
CREATE INDEX "StatusHistory_leadId_at_idx" ON "StatusHistory"("leadId", "at");

-- CreateIndex
CREATE INDEX "FollowUp_userId_dueAt_idx" ON "FollowUp"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_label_key" ON "LeadSource"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_inviteToken_key" ON "Meeting"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_consentToken_key" ON "Meeting"("consentToken");

-- CreateIndex
CREATE INDEX "Meeting_leadId_idx" ON "Meeting"("leadId");

-- CreateIndex
CREATE INDEX "Meeting_engineerUserId_startAt_idx" ON "Meeting"("engineerUserId", "startAt");

-- CreateIndex
CREATE INDEX "LocationTrack_userId_at_idx" ON "LocationTrack"("userId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_meetingId_key" ON "Transcript"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "MinutesOfMeeting_meetingId_key" ON "MinutesOfMeeting"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "MinutesOfMeeting_token_key" ON "MinutesOfMeeting"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_leadId_key" ON "Quote"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_clientToken_key" ON "QuoteVersion"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_quoteId_versionNo_key" ON "QuoteVersion"("quoteId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPipeline_leadId_key" ON "PaymentPipeline"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_invoiceId_key" ON "Milestone"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_fullNumber_key" ON "Invoice"("fullNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_clientToken_key" ON "Invoice"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_fullNumber_key" ON "Receipt"("fullNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_clientToken_key" ON "Receipt"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_approvalId_key" ON "CreditNote"("approvalId");

-- CreateIndex
CREATE INDEX "Approval_status_type_idx" ON "Approval"("status", "type");

-- CreateIndex
CREATE INDEX "Message_leadId_queuedAt_idx" ON "Message"("leadId", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Template_channel_key_key" ON "Template"("channel", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Handover_leadId_key" ON "Handover"("leadId");

-- CreateIndex
CREATE INDEX "Delay_leadId_ruleKey_idx" ON "Delay"("leadId", "ruleKey");

-- CreateIndex
CREATE UNIQUE INDEX "DelayRule_dashboard_ruleKey_key" ON "DelayRule"("dashboard", "ruleKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRule_dashboard_eventKey_key" ON "NotificationRule"("dashboard", "eventKey");

-- CreateIndex
CREATE INDEX "Notification_userId_at_idx" ON "Notification"("userId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_at_idx" ON "AuditLog"("actorUserId", "at");

-- CreateIndex
CREATE INDEX "DocumentChunk_leadId_idx" ON "DocumentChunk"("leadId");

-- CreateIndex
CREATE INDEX "DocumentChunk_docType_docId_idx" ON "DocumentChunk"("docType", "docId");

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_salesStatusId_fkey" FOREIGN KEY ("salesStatusId") REFERENCES "LeadStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_engineerStatusId_fkey" FOREIGN KEY ("engineerStatusId") REFERENCES "LeadStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDetails" ADD CONSTRAINT "BillingDetails_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTrack" ADD CONSTRAINT "LocationTrack_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinutesOfMeeting" ADD CONSTRAINT "MinutesOfMeeting_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objection" ADD CONSTRAINT "Objection_momId_fkey" FOREIGN KEY ("momId") REFERENCES "MinutesOfMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFile" ADD CONSTRAINT "LeadFile_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPipeline" ADD CONSTRAINT "PaymentPipeline_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPipeline" ADD CONSTRAINT "PaymentPipeline_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "PaymentPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delay" ADD CONSTRAINT "Delay_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
