export interface CalendarEventInput { title: string; start: Date; end: Date; attendees?: string[]; withMeet?: boolean; location?: string; description?: string }
export interface CalendarProvider {
  createEvent(userId: string, ev: CalendarEventInput): Promise<{ eventId: string; meetLink?: string }>;
  updateEvent(userId: string, eventId: string, ev: Partial<CalendarEventInput>): Promise<void>;
  deleteEvent(userId: string, eventId: string): Promise<void>;
  freeBusy(userId: string, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>>;
  addToCalendar(userId: string, ev: CalendarEventInput & { eventId?: string }): Promise<{ eventId: string }>;
}
export interface MeetingBotProvider {
  scheduleBot(meetingId: string, meetLink: string, startAt: Date): Promise<{ botId: string }>;
  cancelBot(meetingId: string): Promise<void>;
}
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string }
export interface AIProvider {
  transcribe(audioKey: string): Promise<string>;
  minutes(transcript: string, leadContext: Record<string, unknown>): Promise<string>;
  clientProfile(previousProfile: string | null, transcript: string): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
  chat(messages: ChatMessage[], tools: Record<string, (args: any) => Promise<unknown>>, context: Record<string, unknown>): AsyncIterable<{ delta?: string; citations?: unknown[] }>;
  name: string;
}
export interface SendResult { providerMessageId: string }
export interface WhatsAppProvider {
  sendTemplate(to: string, key: string, vars: Record<string, string>, body: string): Promise<SendResult>;
  sendDocument(to: string, pdfUrl: string, caption: string): Promise<SendResult>;
  submitTemplate(template: { key: string; body: string }): Promise<{ providerStatus: 'submitted' | 'approved' | 'rejected' }>;
  parseWebhook(payload: unknown): Array<{ providerMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: Date }>;
}
export interface SmsProvider {
  send(to: string, templateKey: string, vars: Record<string, string>, body: string): Promise<SendResult>;
  parseDlr(payload: unknown): Array<{ providerMessageId: string; status: 'sent' | 'delivered' | 'failed'; at: Date }>;
}
export interface EmailProvider {
  send(to: string, subject: string, html: string, attachments?: Array<{ filename: string; content: Buffer }>): Promise<SendResult>;
  parseEvents(payload: unknown): Array<{ providerMessageId: string; status: 'delivered' | 'read' | 'failed'; at: Date }>;
}
export interface MapsProvider {
  geocode(address: string): Promise<{ lat: number; lng: number } | null>;
  directionsUrl(office: { lat: number; lng: number }): string;
  distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;
}
export interface StorageProvider {
  putStream(key: string, data: Buffer | NodeJS.ReadableStream, mime?: string): Promise<{ bytes: number }>;
  get(key: string): Promise<Buffer>;
  getSignedUrl(key: string, ttlSec?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
export interface PdfRenderer { render(templateKey: string, data: Record<string, unknown>, outKey: string): Promise<string> }
