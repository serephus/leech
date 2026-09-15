/** Single logging entry point so every line is prefixed consistently. */
export function log(message: string): void {
  console.log(`[leech] ${message}`);
}
