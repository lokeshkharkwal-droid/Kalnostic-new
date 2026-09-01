const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

/** Spell a 0-999 integer in English (e.g. `305` -> "Three Hundred Five"). */
function spellUnderThousand(value: number): string {
  const parts: string[] = [];
  if (value >= 100) {
    parts.push(ONES[Math.floor(value / 100)]!, 'Hundred');
    value %= 100;
  }
  if (value >= 20) {
    parts.push(TENS[Math.floor(value / 10)]!);
    value %= 10;
  }
  if (value > 0) parts.push(ONES[value]!);
  return parts.join(' ');
}

/**
 * Spell a non-negative rupee amount in words using the Indian numbering
 * system (Crore / Lakh / Thousand groups, not the Western Million/Billion
 * grouping), e.g. `1234.5` -> "Rupees One Thousand Two Hundred Thirty Four
 * and Fifty Paise Only". Rounds to the nearest paisa. `0` -> "Rupees Zero
 * Only".
 */
export function amountInWords(value: number): string {
  const rounded = Math.round(Math.abs(value) * 100);
  const rupees = Math.floor(rounded / 100);
  const paise = rounded % 100;

  const groups: Array<[number, string]> = [
    [Math.floor(rupees / 10000000), 'Crore'],
    [Math.floor((rupees / 100000) % 100), 'Lakh'],
    [Math.floor((rupees / 1000) % 100), 'Thousand'],
    [Math.floor(rupees % 1000), ''],
  ];

  const rupeeWords = groups
    .filter(([n]) => n > 0)
    .map(([n, label]) =>
      [spellUnderThousand(n), label].filter(Boolean).join(' '),
    )
    .join(' ');

  const words = `Rupees ${rupeeWords || 'Zero'}`;
  return paise > 0
    ? `${words} and ${spellUnderThousand(paise)} Paise Only`
    : `${words} Only`;
}
