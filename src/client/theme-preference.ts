export const themes = [
  { id: 'classic', label: '经典蓝白', detail: '默认日间 · 最初配色' },
  { id: 'dcim', label: '杰瑞橙', detail: '默认夜间 · 石墨与橙色点缀' },
  { id: 'swiss', label: '瑞士排版', detail: '米白 · 砖红 · 清晰结构' },
  { id: 'forest', label: '暖纸森林', detail: '暖纸 · 松绿 · 柔和边界' },
  { id: 'midnight', label: '午夜控制台', detail: '深炭 · 薄荷 · 低亮度' },
  { id: 'soft', label: '柔彩悬浮', detail: '浅紫 · 柔彩 · 轻阴影' },
  { id: 'industrial', label: '工业黄黑', detail: '黑黄 · 方正 · 强网格' },
] as const;
export type Theme = typeof themes[number]['id'];
export type ThemePreference = Theme | 'system';
export const dayTheme: Theme = 'classic';
export const nightTheme: Theme = 'dcim';
/** 无模块依赖，供文档首屏脚本和 React 共用。 */
export function resolveAppearance(value: string | null, dark: boolean, ids: readonly string[], day: string, night: string) {
  const wanted = value === 'dark' ? night : value === 'light' ? day : value;
  const preference = wanted && ids.includes(wanted) ? wanted : 'system';
  return {preference, theme: preference === 'system' ? dark ? night : day : preference};
}
export function resolveThemePreference(value: string | null): ThemePreference {
  return resolveAppearance(value, false, themes.map(theme => theme.id), dayTheme, nightTheme).preference as ThemePreference;
}
export function resolveTheme(value: string | null, dark = false): Theme {
  return resolveAppearance(value, dark, themes.map(theme => theme.id), dayTheme, nightTheme).theme as Theme;
}
