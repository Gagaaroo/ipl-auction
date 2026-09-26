/** All money is kept in lakh (1 Cr = 100 L). */

export const MIN_SLOT_LAKH = 20;

export function increment(currentLakh: number): number {
  if (currentLakh < 100) return 10;
  if (currentLakh < 200) return 20;
  if (currentLakh < 500) return 25;
  if (currentLakh < 1000) return 50;
  return 100;
}

/** The next legal bid: base price for the opening bid, otherwise current + increment. */
export function nextBidAmount(currentLakh: number | null, baseLakh: number): number {
  if (currentLakh === null) return baseLakh;
  return currentLakh + increment(currentLakh);
}

export function formatLakh(lakh: number): string {
  if (lakh >= 100) {
    const cr = lakh / 100;
    return `₹${Number.isInteger(cr) ? cr : cr.toFixed(2).replace(/0$/, '')} Cr`;
  }
  return `₹${lakh} L`;
}
