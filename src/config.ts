import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date in YYYY-MM-DD format');
const station = z.string().trim().regex(/^[A-Z]{2,5}$/, 'Use a station code, for example NDLS');
const passenger = z.object({
  name: z.string().trim().min(1).max(80),
  age: z.number().int().min(1).max(120),
  gender: z.enum(['M', 'F', 'T']),
  berthPreference: z.enum(['NO_PREFERENCE', 'LOWER', 'MIDDLE', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER']).default('NO_PREFERENCE'),
}).strict();

export const journeySchema = z.object({
  quota: z.enum(['GENERAL', 'TATKAL']),
  from: station,
  to: station,
  boardingStation: station,
  journeyDate: date,
  trainOriginDate: date.optional(),
  trainNumber: z.string().regex(/^\d{5}$/),
  travelClass: z.enum(['1A', '2A', '3A', '3E', 'CC', 'EC', 'SL', '2S', 'FC']),
  passengers: z.array(passenger).min(1).max(6),
  maxFare: z.number().finite().positive(),
  allowWaitlist: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.from === value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Destination must differ from origin' });
  if (value.trainOriginDate && value.trainOriginDate > value.journeyDate) {
    ctx.addIssue({ code: 'custom', path: ['trainOriginDate'], message: 'Train origin date cannot be after boarding date' });
  }
  if (value.quota === 'TATKAL' && !value.trainOriginDate) {
    ctx.addIssue({ code: 'custom', path: ['trainOriginDate'], message: 'Tatkal requires the departure date at the train origin' });
  }
});

export type Journey = z.infer<typeof journeySchema>;

export function indiaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function validateJourney(input: unknown, now = new Date()): Journey {
  const journey = journeySchema.parse(input);
  if (journey.journeyDate < indiaDate(now)) throw new Error('Journey date is in the past in Asia/Kolkata.');
  return journey;
}

export async function loadJourney(file: string): Promise<Journey> {
  return validateJourney(JSON.parse(await readFile(file, 'utf8')));
}
