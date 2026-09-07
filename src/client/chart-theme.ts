/** 将 CSS 语义色解析成 Canvas/ECharts 都能处理的 RGBA，保留 option 中的函数。 */
export function chartCategoryColor(dimension: string | undefined, key: string): string | undefined {
  const roles: Record<string, Record<string, string>> = {
    risk: { high: "danger", medium: "warning", low: "success", unassessed: "text-muted" },
    status: { in_progress: "chart-line", completed: "success", resolved: "success", blocked: "warning", deferred: "warning", cancelled: "text-muted", planning: "text-muted", not_started: "text-muted", pending_acceptance: "purple" },
    priority: { P0: "danger", P1: "warning", P2: "info", P3: "text-muted" },
  };
  const role = dimension ? roles[dimension]?.[key] : undefined;
  return role ? `var(--${role})` : undefined;
}

export function resolveChartTokens(option: Record<string, unknown>, resolve: (token: string) => string): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string" && /^var\(--[\w-]+\)$/.test(value)) return resolve(value.slice(4, -1));
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    }
    return value;
  };
  return visit(option) as Record<string, unknown>;
}

export function chartColorResolver(element: HTMLElement) {
  const probe = document.createElement("span");
  probe.style.display = "none";
  element.append(probe);
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const colors = new Map<string, string>();
  return {
    resolve(token: string) {
      if (colors.has(token)) return colors.get(token)!;
      probe.style.color = `var(${token})`;
      let value = getComputedStyle(probe).color;
      if (context) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        value = `rgba(${r},${g},${b},${a / 255})`;
      }
      colors.set(token, value);
      return value;
    },
    dispose() { probe.remove(); },
  };
}
