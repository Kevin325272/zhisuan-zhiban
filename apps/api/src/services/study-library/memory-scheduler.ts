import { createEmptyCard, fsrs, Rating, type CardInput } from "ts-fsrs";
import type { MemoryReview } from "@xuetu/contracts";
const scheduler = fsrs({ enable_fuzz: false });
const ratings = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;
export function memoryDay(date: Date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
export function scheduleMemoryCard(
  state: CardInput | null,
  rating: MemoryReview["rating"],
  now: Date,
) {
  const card = scheduler.next(
    state ?? createEmptyCard(now),
    now,
    ratings[rating],
  ).card;
  return {
    state: card,
    due: card.due,
    completed: memoryDay(card.due) > memoryDay(now),
  };
}
