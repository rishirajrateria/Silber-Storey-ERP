process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.QUEUE_MODE = 'inline';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://app:app@localhost:5432/leadapp_test';
process.env.STORAGE_DIR = '.storage-test';
process.env.GOOGLE_WORKSPACE_DOMAIN = 'example.com';
delete process.env.REDIS_URL;
