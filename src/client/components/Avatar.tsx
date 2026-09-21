/** 姓名末字头像。 */
export function Avatar({ name, className = "" }: { name: string; className?: string }) {
  const initial = Array.from(name.trim()).at(-1) || "?";
  return <span className={`avatar${className ? ` ${className}` : ""}`} aria-hidden="true">{initial}</span>;
}
