# 按钮预设

操作使用 `Button`，页面跳转使用 `ButtonLink`。定义集中在 `src/client/components/Button.tsx` 和 `button.css`。

## 选择规则

| 场景 | variant | tone |
|---|---|---|
| 新建、保存、开始 | primary | primary：灰蓝 |
| 取消、刷新、普通操作 | secondary | neutral |
| 完成、交付 | soft | success：浅灰绿 |
| 返工、重新打开 | soft | warning：浅砂色 |
| 删除、移除、不可逆确认 | soft | danger：浅灰红 |
| 更多、关闭、移动箭头 | ghost + iconOnly | neutral |
| 资料跳转、面包屑 | link | primary / neutral |
| 筛选触发器 | field | neutral：与输入框同字号、字重、左对齐 |
| 下拉菜单 | menu | neutral / danger |

`TopbarMenu` 自动将内部操作呈现为菜单项，保持文字左对齐。主操作颜色与甘特条颜色独立，深浅主题分别配色。

## 尺寸

| size | 高度 | 使用位置 |
|---|---:|---|
| mini | 24px | 树表展开、拖拽手柄 |
| compact | 30px | 甘特行内操作、分段切换 |
| small | 32px | 紧凑表格、进度快捷值 |
| medium | 36px | 默认工具栏、表单 |
| large | 40px | 需要强调的独立入口 |

圆角固定 6px；图标按钮宽高相同。固定宽度通过 `width` 选择：`action` 66px、`wide` 96px、`filter` 148px、`block` 填满容器。公共工具栏保留既有固定槽位及窄屏布局。

```tsx
<Button variant="soft" tone="success" size="compact" width="action" onClick={complete}>
  <Check />完成
</Button>
<Button type="submit" variant="primary" busy={saving}>保存修改</Button>
```

按钮默认 `type="button"`；提交表单明确写 `type="submit"`。`busy` 保留原内容占位，原位显示加载标记、禁止重复点击，并提供 `aria-busy`。悬浮、按下、聚焦不改变尺寸。

## 防止页面再次覆盖

- 页面 CSS 放在 `application` 层，公共按钮在 `controls` 层；异步加载页面也不能覆盖按钮预设。
- `className` 仅作布局与既有 DOM 定位。新增配色、尺寸进入公共预设，不写行内样式或页面专属按钮规则。
- `npm run lint` 检查原生操作按钮、行内覆盖、越过样式层和按钮 `!important`。现有 DOM 定位类保留兼容；颜色及尺寸由公共预设控制。
- 标题、图表节点、日历单元、选项、拖拽命中区域属于内容控件，保留各自业务表现；它们不作为新增普通操作按钮的入口。

验证覆盖主题对比度、加载和悬浮尺寸、表单提交、菜单、拖拽、公共工具栏、详情浮窗及窄屏布局。
