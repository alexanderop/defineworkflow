import { z } from "defineworkflow";

export const HaikuSchema = z.object({
  haiku: z.string().describe("a three-line haiku"),
  syllables: z.array(z.number()).describe("syllable count per line, e.g. [5,7,5]"),
});
