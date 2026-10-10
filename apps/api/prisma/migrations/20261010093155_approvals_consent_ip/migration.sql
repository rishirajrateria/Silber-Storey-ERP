-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'invoice_cancellation';

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "consentIp" TEXT,
ADD COLUMN     "inviteIp" TEXT;
