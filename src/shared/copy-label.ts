export function copyLabel(value: string, suffix = ' 副本'): string {
  return value.slice(0, 200 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
}
