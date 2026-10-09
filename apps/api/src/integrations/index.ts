import { config } from '../config.js';
import * as m from './mock.js';
import * as r from './real.js';
export type * from './types.js';

const mock = config.mockMode;
export const calendar = mock ? m.mockCalendar : r.realCalendar;
export const bot = mock ? m.mockBot : r.realBot;
export const ai = mock ? m.mockAI : r.realAI;
export const whatsapp = mock ? m.mockWhatsApp : r.realWhatsApp;
export const sms = mock ? m.mockSms : r.realSms;
export const email = mock ? m.mockEmail : r.realEmail;
export const maps = mock ? m.mockMaps : r.realMaps;
export const storage = mock || !config.s3.endpoint ? m.fsStorage : r.s3Storage;
export const pdf = mock ? m.mockPdf : r.playwrightPdf;
