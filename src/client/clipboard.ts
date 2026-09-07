/** 复制到剪贴板（含 execCommand 降级），返回是否成功。 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    try {
      input.select();
      return document.execCommand("copy");
    } finally {
      input.remove();
    }
  } catch {
    return false;
  }
}
