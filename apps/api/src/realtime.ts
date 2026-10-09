import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { sessions } from './plugins/session.js';
import { prisma } from './lib/db.js';
import { config } from './config.js';

let io: Server | null = null;
export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: config.appUrl, credentials: true } });
  const auth = async (socket: any, next: any) => {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(socket.handshake.headers.cookie ?? '')?.[1];
    const s = sid ? await sessions.get(sid) : null;
    const u = s ? await prisma.user.findUnique({ where: { id: s.userId } }) : null;
    if (!u) return next(new Error('unauthenticated'));
    socket.data.user = u; next();
  };
  io.of('/notify').use(auth).on('connection', (s) => s.join(`user:${s.data.user.id}`));
  io.of('/approvals').use(auth);
  io.of('/location').use(auth).use((s, next) => (s.data.user.role === 'admin' ? next() : next(new Error('admin only'))));
  io.of(/^\/lead\/[\w-]+$/).use(auth).on('connection', (s) => s.join(s.nsp.name));
  return io;
}
export const rt = {
  notify(userId: string, payload: unknown) { io?.of('/notify').to(`user:${userId}`).emit('notification', payload); },
  approvals(payload: unknown) { io?.of('/approvals').emit('approval', payload); },
  location(payload: unknown) { io?.of('/location').emit('location', payload); },
  lead(leadId: string, payload: unknown) { io?.of(`/lead/${leadId}`).emit('timeline', payload); },
};
