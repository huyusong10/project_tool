import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Over,
  type Modifier,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {createPortal} from 'react-dom';
import {DragPreview, type DragPreviewData} from './DragPreview';

type DraggableState = ReturnType<typeof useDraggable>;

// The activator stays visible in pinned columns even when the full row is offscreen.
const previewAtHandle: Modifier = ({transform, activatorEvent, activeNodeRect}) => {
  if (!activeNodeRect) return transform;
  const pointer = activatorEvent && 'clientX' in activatorEvent ? activatorEvent as MouseEvent : null;
  return {...transform,
    x:transform.x + (pointer ? pointer.clientX - 24 : Math.max(12, activeNodeRect.left)) - activeNodeRect.left,
    y:transform.y + (pointer ? pointer.clientY - 24 - activeNodeRect.top : 0),
  };
};

export type SortableListItemState = {
  setNodeRef: (node: HTMLElement | null) => void;
  handleAttributes: DraggableState["attributes"];
  handleListeners: DraggableState["listeners"];
  isDragging: boolean;
  isOver: boolean;
  /** 拖拽位移（如需跟随光标的视觉位移，translate3d 到渲染节点）。 */
  transform: DraggableState["transform"];
};

type SortableListProps<T> = {
  items: T[];
  getId: (item: T, index: number) => string;
  onReorder: (items: T[], fromIndex: number, toIndex: number) => void | Promise<void>;
  renderItem: (item: T, index: number, state: SortableListItemState) => ReactNode;
  getPreview: (item: T) => DragPreviewData;
  disabled?: boolean;
};

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function SortableItem<T>({
  item,
  index,
  id,
  activeId,
  overId,
  disabled,
  renderItem,
}: {
  item: T;
  index: number;
  id: string;
  activeId: string | null;
  overId: string | null;
  disabled: boolean;
  renderItem: SortableListProps<T>["renderItem"];
}) {
  const draggable = useDraggable({ id, disabled });
  const droppable = useDroppable({ id, disabled });
  const setNodeRef = useCallback((node: HTMLElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  }, [draggable, droppable]);

  return renderItem(item, index, {
    setNodeRef,
    handleAttributes: draggable.attributes,
    handleListeners: draggable.listeners,
    isDragging: activeId === id,
    isOver: overId === id && activeId !== id,
    transform: draggable.transform,
  });
}

export function SortableList<T>({ items, getId, onReorder, renderItem, getPreview, disabled = false }: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const startedIds = useRef("");
  const invalidated = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {coordinateGetter: (event, {context, currentCoordinates}) => {
      const direction = ['ArrowDown', 'ArrowRight'].includes(event.code) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.code) ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const currentId = String(context.over?.id || context.active?.id || '');
      const index = items.findIndex((item, i) => getId(item, i) === currentId);
      const next = items[index + direction];
      const current = context.droppableRects.get(currentId), target = next && context.droppableRects.get(getId(next, index + direction));
      if (current && target) return {x: currentCoordinates.x + target.left - current.left, y: currentCoordinates.y + target.top - current.top};
    }}),
  );
  const ids = useMemo(() => items.map(getId), [getId, items]);
  const idsKey = ids.join("\u0000");
  const clear = () => {
    setActiveId(null);
    setOverId(null);
  };
  const activeKey = (active: Active | null) => active ? String(active.id) : null;
  const overKey = (over: Over | null) => over ? String(over.id) : null;
  useEffect(() => {
    if (!activeId || startedIds.current === idsKey) return;
    invalidated.current = true;
    setActiveId(null);
    setOverId(null);
  }, [activeId, idsKey]);

  return <DndContext
    sensors={sensors}
    onDragStart={({ active }) => {
      const key = activeKey(active);
      startedIds.current = idsKey;
      invalidated.current = false;
      setActiveId(key);
      setOverId(key);
    }}
    onDragOver={({ over }) => setOverId(overKey(over))}
    onDragCancel={() => { startedIds.current = ""; invalidated.current = false; clear(); }}
    onDragEnd={({ active, over }) => {
      const invalid = invalidated.current || startedIds.current !== idsKey;
      startedIds.current = "";
      invalidated.current = false;
      const fromIndex = ids.indexOf(String(active.id));
      const toIndex = over ? ids.indexOf(String(over.id)) : -1;
      clear();
      if (invalid || disabled) return;
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      void onReorder(moveItem(items, fromIndex, toIndex), fromIndex, toIndex);
    }}
  >
    {items.map((item, index) => {
      const id = getId(item, index);
      return <SortableItem
        key={id}
        item={item}
        index={index}
        id={id}
        activeId={activeId}
        overId={overId}
        disabled={disabled}
        renderItem={renderItem}
      />;
    })}
    {typeof document !== 'undefined' && createPortal(<DragOverlay dropAnimation={null} zIndex={1000} modifiers={[previewAtHandle]}>
      {activeId && items.find((item, index) => getId(item, index) === activeId) !== undefined && <DragPreview {...getPreview(items[ids.indexOf(activeId)])}/>}
    </DragOverlay>, document.body)}
  </DndContext>;
}
