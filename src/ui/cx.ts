/** 拼接 className，忽略假值。 */
export function cx(...values: readonly (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
