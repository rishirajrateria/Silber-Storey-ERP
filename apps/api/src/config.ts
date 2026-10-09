import 'dotenv/config';

const bool = (v: string | undefined, d = false) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isTest: process.env.NODE_ENV === 'test',
  mockMode: bool(process.env.MOCK_MODE, true),
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  apiUrl: process.env.API_URL ?? 'http://localhost:4000',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/leadapp',
  redisUrl: process.env.REDIS_URL,
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret',
  /** inline = run jobs synchronously (tests); timer = in-process timers; bullmq = Redis-backed */
  queueMode: (process.env.QUEUE_MODE ?? (process.env.NODE_ENV === 'test' ? 'inline' : 'timer')) as 'inline' | 'timer' | 'bullmq',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    workspaceDomain: process.env.GOOGLE_WORKSPACE_DOMAIN ?? '',
    mapsKey: process.env.GOOGLE_MAPS_KEY ?? '',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET ?? 'leadapp', accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '', region: process.env.S3_REGION ?? 'us-east-1',
  },
  whatsapp: { token: process.env.WHATSAPP_TOKEN ?? '', phoneId: process.env.WHATSAPP_PHONE_ID ?? '', verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '' },
  sms: { key: process.env.SMS_PROVIDER_KEY ?? '', senderId: process.env.SMS_SENDER_ID ?? '' },
  email: {
    host: process.env.EMAIL_SMTP_HOST ?? '', port: Number(process.env.EMAIL_SMTP_PORT ?? 587), user: process.env.EMAIL_SMTP_USER ?? '',
    pass: process.env.EMAIL_SMTP_PASS ?? '', from: process.env.EMAIL_FROM ?? 'noreply@example.com',
  },
  geminiKey: process.env.GEMINI_API_KEY ?? '',
  meetingBotKey: process.env.MEETING_BOT_API_KEY ?? '',
  office: { address: process.env.OFFICE_ADDRESS ?? '1 Office Road, Mumbai', lat: Number(process.env.OFFICE_LAT ?? 19.076), lng: Number(process.env.OFFICE_LNG ?? 72.8777) },
  storageDir: process.env.STORAGE_DIR ?? '.storage',
};
