# Lead Management & Consultation Web App (Phase 1)

Monorepo: `apps/api` (Fastify + Prisma), `apps/web` (Next.js 14, Tailwind, glass UI), `packages/shared` (enums, zod schemas, quote maths).

## Run (mock mode, no credentials)
```bash
cp .env.example .env            # MOCK_MODE=true by default
docker compose up -d postgres redis minio
pnpm install
pnpm --filter api prisma:migrate   # or prisma:deploy
pnpm --filter api seed
pnpm dev                           # api :4000, web :3000
```
Open http://localhost:3000/login and pick a seeded user (admin, sales, engineer, finance, design head, junior designer — `*@<GOOGLE_WORKSPACE_DOMAIN>`).

Or everything in Docker: `docker compose up --build`.

## Checks
```bash
pnpm lint    # tsc across packages
pnpm test    # vitest: one test per Section 9 rule (needs DATABASE_URL / TEST_DATABASE_URL)
```

## Demo walkthrough
1. Sales → New lead (duplicate phone → override approval) → status with follow-up → Genuine + Seems positive → Transfer.
2. Engineer → lead → Meetings → schedule (invite + consent links in Admin → Messages) → open `/p/invite/:token`, `/p/consent/:token` → Meeting room → start → record → complete → MoM emailed with objection link.
3. Engineer → Quote → v1 (needs approval) → Admin approves → Send → client accepts on `/p/quote/:token` → Billing → Push to finance.
4. Finance → Pipeline → Invoice → Send (numbered) → Record payment → receipt; milestone 1 paid ⇒ `advance_paid`.
5. Engineer → Handover → push to design → Design head assigns junior → internal meeting → three acceptances ⇒ `handover_accepted`.
6. Admin → Approvals, Delays, Projects roadmap, Messages, Templates, Settings, AI assistant, Audit, View-as.

See `DECISIONS.md` for choices made where the spec was silent.
