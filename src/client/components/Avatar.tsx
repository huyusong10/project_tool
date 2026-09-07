/** 姓名首/尾字头像，替代 5 处手写的 slice 圆形块。 */
export function Avatar({ name, className = "" }: { name: string; className?: string }) {
  const initial = name.trim() ? name.trim().slice(-1) : "?";
  return <span className={`avatar${className ? ` ${className}` : ""}`} aria-hidden="true">{initial}</span>;
}
