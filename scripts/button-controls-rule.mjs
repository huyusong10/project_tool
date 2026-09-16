// Native buttons below are interactive data/field widgets, not action controls.
const widgetClasses = new Set([
  'human-next-window', 'delivery-phase-chip', 'feature-name-button', 'gantt-date-progress',
  'gantt-milestone-label', 'gantt-milestone-actual', 'gantt-milestone-undated',
  'requirement-gantt-item-link', 'graph-title', 'business-handle', 'graph-reconnect-handle',
  'inline-edit-trigger', 'issue-status-trigger', 'stat-card-select', 'path-gantt-name',
  'stage-badge', 'workspace-requirement-progress', 'panel-resize-handle', 'sidebar-collapse-button',
  'template-plan-name', 'canvas-draft-status', 'project-switcher-button', 'work-progress-link',
  'sortable-drag-handle', 'workspace-delivery-point', 'workspace-row-title', 'outline-title',
  'action-item', 'issue-title-button', 'issue-latest-update-button', 'my-owned-requirement-link',
  'people-group-toggle', 'member-candidate-option', 'detail-work-row-title', 'sortable-table-heading', 'template-name-button',
]);
const compoundWidgets = new Set(['Form.tsx', 'GanttTimeline.tsx', 'GanttNavigation.tsx', 'GapTimeline.tsx', 'IssueForms.tsx', 'IssueStatusControl.tsx', 'PathAnalysisPanel.tsx', 'TemplateForm.tsx', 'WorkspaceGantt.tsx']);
export default {
  meta: {type: 'problem', schema: [], messages: {
    raw: '操作按钮使用 Button；跳转按钮使用 ButtonLink。颜色、样式、尺寸从公共预设选择。',
    style: '按钮不接受 style/color 或 data-* 样式覆盖；使用 variant/tone/size/width 预设。',
  }},
  create(context) {
    const file = context.filename.replaceAll('\\', '/').split('/').at(-1);
    return { JSXOpeningElement(node) {
      const tag = node.name.name;
      if (file === 'Button.tsx') return;
      const attr = name => node.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === name);
      if (tag === 'Button' || tag === 'ButtonLink') {
        if (['style', 'color', 'data-variant', 'data-tone', 'data-size', 'data-width', 'data-icon-only'].some(attr)) context.report({node, messageId: 'style'});
        return;
      }
      if (['a', 'Link', 'NavLink'].includes(tag) && /primary-button|ghost-button|icon-button|ui-button/.test(attr('className') ? context.sourceCode.getText(attr('className')) : '')) context.report({node, messageId: 'raw'});
      if (tag !== 'button') return;
      const role = attr('role')?.value?.value;
      if (['option', 'tab', 'radio', 'gridcell', 'combobox'].includes(role)) return;
      const cls = attr('className');
      const text = cls ? context.sourceCode.getText(cls) : '';
      if (/[a-z-]+/g[Symbol.match](text)?.some(token => widgetClasses.has(token))) return;
      if (compoundWidgets.has(file) && !/ghost-button|primary-button|icon-button|danger/.test(text)) return;
      context.report({node, messageId: 'raw'});
    }};
  },
};
