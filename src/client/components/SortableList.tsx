import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Over,
} from "@dnd-kit/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";

type DraggableState = ReturnType<typeof useDraggable>;

export type SortableListItemState = {
  setNodeRef: (node: HTMLElement | null) => void;
  handleAttributes: DraggableState["attributes"];
  handleListeners: DraggableState["listeners"];
  isDragging: boolean;
  isOver: boolean;
};

type SortableListProps<T> = {
  items: T[];
  getId: (item: T, index: number) => string;
  onReorder: (items: T[], fromIndex: number, toIndex: number) => void | Promise<void>;
  renderItem: (item: T, index: number, state: SortableListItemState) => ReactNode;
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
  }, [draggable.setNodeRef, droppable.setNodeRef]);

  return renderItem(item, index, {
    setNodeRef,
    handleAttributes: draggable.attributes,
    handleListeners: draggable.listeners,
    isDragging: activeId === id,
    isOver: overId === id && activeId !== id,
  });
}

export function SortableList<T>({ items, getId, onReorder, renderItem, disabled = false }: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const ids = useMemo(() => items.map(getId), [getId, items]);
  const clear = () => {
    setActiveId(null);
    setOverId(null);
  };
  const activeKey = (active: Active | null) => active ? String(active.id) : null;
  const overKey = (over: Over | null) => over ? String(over.id) : null;

  return <DndContext
    sensors={sensors}
    onDragStart={({ active }) => {
      const key = activeKey(active);
      setActiveId(key);
      setOverId(key);
    }}
    onDragOver={({ over }) => setOverId(overKey(over))}
    onDragCancel={clear}
    onDragEnd={({ active, over }) => {
      const fromIndex = ids.indexOf(String(active.id));
      const toIndex = over ? ids.indexOf(String(over.id)) : -1;
      clear();
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
  </DndContext>;
}
