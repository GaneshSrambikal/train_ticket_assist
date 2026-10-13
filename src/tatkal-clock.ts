import type { Journey } from './config.js';

const acClasses = new Set(['1A', '2A', '3A', '3E', 'CC', 'EC']);

// Scheduling guidance only: this never authorizes or submits a booking.
// IRCTC's live quota availability remains authoritative.
export function tatkalOpensAt(journey: Journey): Date | null {
  if (journey.quota === 'GENERAL') return null;
  if (!journey.trainOriginDate) throw new Error('Tatkal requires trainOriginDate.');
  const previousDay = new Date(`${journey.trainOriginDate}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const hour = acClasses.has(journey.travelClass) ? '10' : '11';
  return new Date(`${previousDay.toISOString().slice(0, 10)}T${hour}:00:00+05:30`);
}

export function millisecondsUntilOpening(journey: Journey, now = new Date()): number {
  const opening = tatkalOpensAt(journey);
  return opening ? Math.max(0, opening.getTime() - now.getTime()) : 0;
}
