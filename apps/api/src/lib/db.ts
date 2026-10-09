import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient({ log: process.env.PRISMA_LOG ? ['query'] : [] });
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
