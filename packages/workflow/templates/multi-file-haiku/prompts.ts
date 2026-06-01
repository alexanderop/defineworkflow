export function haikuPrompt(topic: string): string {
  return `Write a single haiku about "${topic}". Return the haiku and the syllable count of each line.`;
}
