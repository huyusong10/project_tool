export function copyLabel(value: string, suffix = ' 副本', maxLength = 200): string {
  return value.slice(0, maxLength - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
}
