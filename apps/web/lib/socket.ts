'use client';
import { io, type Socket } from 'socket.io-client';
const sockets = new Map<string, Socket>();
export function ns(name: string) {
  if (!sockets.has(name)) sockets.set(name, io(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}${name}`, { withCredentials: true, autoConnect: true, reconnectionAttempts: 5 }));
  return sockets.get(name)!;
}
