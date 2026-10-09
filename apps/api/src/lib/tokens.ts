import { randomBytes } from 'node:crypto';
export const newToken = () => randomBytes(32).toString('hex');
