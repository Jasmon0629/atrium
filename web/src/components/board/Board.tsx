import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { api, tryMutate } from '../../lib/api';
import { useHotkey } from '../../lib/useHotkeys';
import { useAuth } from '../../stores/auth';
import { useData } from '../../stores/data';
import { toast } from '../../stores/ui';
import { useConfirm } from '../ConfirmDialog';
import { Kbd, ProgressRing, cx } from '../ui';
import { TaskCard } from './TaskCard';
import type { Column, Priority, Role, Task } from '../../lib/types';

export type BoardSort = 'position' | 'due' | 'priority';

export interface BoardFilter {
  text: string;
  priorities: Priority[];
  assignees: number[];
  sort: BoardSort;
}

export const EMPTY_FILTER: BoardFilter = { text: '', priorities: [], assignees: [], sort: 'position' };

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function matches(task: Task, f: BoardFilter): boolean {
  if (f.text) {
    const q = f.text.toLowerCase();
    const hit =
      task.title.toLowerCase().includes(q) ||
      task.description.toLowerCase().includes(q) ||
      task.tags.some((t) => t.toLowerCase().includes(q));
    if (!hit) return false;
  }
  if (f.priorities.length && !f.priorities.includes(task.priority)) return false;
  if (f.assignees.length && !f.assignees.some((id) => task.assignees.includes(id))) return false;
  return true;
}

function sortTasks(list: Task[], sort: BoardSort): Task[] {
  return [...list].sort((a, b) => {
    if (sort === 'due') return (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.position - b.position;
    if (sort === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.position - b.position;
    return a.position - b.position;
  });
}

/** Position that lands between two neighbours (or at either end). */
function between(before: { position: number } | undefined, after: { position: number } | undefined): number {
  if (!before && !after) return 1;
  if (!before) return after!.position - 1;
  if (!after) return before.position + 1;
  return (before.position + after.position) / 2;
}

/** Animated column count: pops on every change. */
function Count({ value, muted }: { value: number; muted?: number }) {
  return (
    <span className="rounded-full bg-panel px-1.5 text-[11px] font-semibold text-ink-400">
      <span key={value} className="count-pop">
        {value}
      </span>
      {muted ? <span className="text-ink-300"> +{muted}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Drag and drop
//
// Pointer-based: the card lifts after 4 px of movement, follows the pointer
// exactly (DragOverlay), the drop target is whatever column is UNDER THE
// POINTER (not under the card's centre), and the drop is instant — no drop
// animation, no minimum delay. Siblings step aside in 120 ms.
// ---------------------------------------------------------------------------

type DragData = { type: 'task'; id: number; columnId: number } | { type: 'column'; id: number };
/** Visible task ids per column, in board order — the thing the drag mutates. */
type Order = Record<number, number[]>;

const taskKey = (id: number) => `task-${id}`;
const colKey = (id: number) => `col-${id}`;
const FAST = { duration: 120, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

/**
 * Columns: nearest column centre. Tasks: the column under the pointer, then
 * the task in that column nearest the pointer; an empty stretch of column
 * (or an empty column) targets the column itself, meaning "append here".
 */
const collision: CollisionDetection = (args) => {
  const active = args.active.data.current as DragData | undefined;
  const columns = args.droppableContainers.filter((c) => (c.data.current as DragData | undefined)?.type === 'column');
  if (active?.type === 'column') return closestCenter({ ...args, droppableContainers: columns });

  const underPointer = pointerWithin({ ...args, droppableContainers: columns });
  const hit = underPointer[0] ?? rectIntersection({ ...args, droppableContainers: columns })[0];
  if (!hit) return [];
  const colId = (hit.data?.droppableContainer?.data.current as DragData | undefined)?.id ?? Number(String(hit.id).replace('col-', ''));
  const tasks = args.droppableContainers.filter((c) => {
    const d = c.data.current as DragData | undefined;
    return d?.type === 'task' && d.columnId === colId && c.id !== args.active.id;
  });
  if (tasks.length === 0 || !args.pointerCoordinates) return [{ id: hit.id }];
  // Nearest task to the pointer itself, so the target follows the hand
  const { x, y } = args.pointerCoordinates;
  const point = { top: y, bottom: y, left: x, right: x, width: 0, height: 0 };
  const nearest = closestCenter({ ...args, collisionRect: point, droppableContainers: tasks });
  return nearest.length ? nearest : [{ id: hit.id }];
};

/**
 * The one focusable element per card. Enter opens the task; Space picks it up
 * for a keyboard move (arrows, Space to drop, Esc to cancel).
 */
function SortableTask({
  task,
  columnId,
  canDrag,
  onOpen,
  children,
}: {
  task: Task;
  columnId: number;
  canDrag: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: taskKey(task.id),
    data: { type: 'task', id: task.id, columnId } satisfies DragData,
    disabled: !canDrag,
    transition: FAST,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={task.title}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented) {
          e.preventDefault();
          onOpen();
        }
      }}
      data-task-id={task.id}
      className={cx('rounded-lg', canDrag && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-30')}
    >
      {children}
    </div>
  );
}

export function Board({
  groupId,
  role,
  filter = EMPTY_FILTER,
}: {
  groupId: number;
  role: Role;
  filter?: BoardFilter;
}) {
  const gd = useData((s) => s.groupData[groupId]);
  const moveTaskLocal = useData((s) => s.moveTaskLocal);
  const applyColumns = useData((s) => s.applyColumns);
  const fetchGroup = useData((s) => s.fetchGroup);
  const openTaskModal = useData((s) => s.openTaskModal);
  const me = useAuth((s) => s.user);
  const ask = useConfirm();
  const canEdit = role === 'member' || role === 'admin';
  const isAdmin = role === 'admin';
  const canDrag = canEdit && filter.sort === 'position';
  const filtering = filter.text !== '' || filter.priorities.length > 0 || filter.assignees.length > 0;

  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [activeCol, setActiveCol] = useState<number | null>(null);
  const [active, setActive] = useState<DragData | null>(null);
  const [dragOrder, setDragOrder] = useState<Order | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const columns = useMemo(() => (gd ? [...gd.columns].sort((a, b) => a.position - b.position) : []), [gd?.columns]);
  const columnKey = columns.map((c) => c.id).join(',');
  const taskById = useMemo(() => new Map((gd?.tasks || []).map((t) => [t.id, t])), [gd?.tasks]);

  const tasksIn = useCallback(
    (colId: number, applyFilter = true): Task[] => {
      const list = (gd?.tasks || []).filter((t) => t.columnId === colId && (!applyFilter || matches(t, filter)));
      return applyFilter ? sortTasks(list, filter.sort) : sortTasks(list, 'position');
    },
    [gd?.tasks, filter]
  );

  // What each column shows; during a drag a snapshot of this is mutated instead
  const visibleOrder = useMemo<Order>(() => {
    const o: Order = {};
    for (const c of columns) o[c.id] = tasksIn(c.id).map((t) => t.id);
    return o;
  }, [columns, tasksIn]);
  const order = dragOrder ?? visibleOrder;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    // Space picks up / drops; Enter is left free to open the task
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } })
  );

  // Phones show one column at a time (scroll-snap); track which one is in view
  // so the segmented pager above the board can highlight it.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-col-id]'));
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const best = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) setActiveCol(Number((best.target as HTMLElement).dataset.colId));
      },
      { root, threshold: [0.55] }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [columnKey]);

  function scrollToColumn(colId: number) {
    document.getElementById(`col-${colId}`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  // `n` anywhere on the board starts a new task in the first column
  useHotkey(
    'new-task',
    useCallback(() => {
      if (!canEdit || columns.length === 0) return;
      setAddingTo(columns[0].id);
      setNewTitle('');
    }, [canEdit, columns])
  );

  if (!gd) return null;

  // ---- drag handlers ----

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as DragData | undefined;
    if (!d) return;
    setActive(d);
    setMenuFor(null);
    if (d.type === 'task') setDragOrder(visibleOrder);
  }

  /** Crossing into another column moves the card there straight away, at the hovered spot. */
  function onDragOver(e: DragOverEvent) {
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as DragData | undefined;
    if (!a || a.type !== 'task' || !o || !dragOrder) return;
    const fromCol = Object.keys(dragOrder).map(Number).find((c) => dragOrder[c].includes(a.id));
    const toCol = o.type === 'column' ? o.id : o.columnId;
    if (fromCol === undefined || toCol === fromCol) return;
    const overCentre = e.over ? e.over.rect.top + e.over.rect.height / 2 : 0;
    const activeTop = e.active.rect.current.translated?.top ?? 0;
    const below = activeTop > overCentre;
    setDragOrder((prev) => {
      if (!prev) return prev;
      const next: Order = { ...prev, [fromCol]: prev[fromCol].filter((id) => id !== a.id) };
      const list = (prev[toCol] || []).filter((id) => id !== a.id);
      let idx = list.length;
      if (o.type === 'task') {
        const i = list.indexOf(o.id);
        if (i >= 0) idx = i + (below ? 1 : 0);
      }
      list.splice(idx, 0, a.id);
      next[toCol] = list;
      return next;
    });
  }

  function onDragCancel() {
    setActive(null);
    setDragOrder(null);
  }

  function onDragEnd(e: DragEndEvent) {
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as DragData | undefined;
    const snapshot = dragOrder;
    setActive(null);
    setDragOrder(null);
    if (!a || !o) return;

    // Column reordering (admins drag the column header)
    if (a.type === 'column') {
      if (!isAdmin || o.type !== 'column' || o.id === a.id) return;
      const ids = columns.map((c) => c.id);
      const next = arrayMove(ids, ids.indexOf(a.id), ids.indexOf(o.id));
      const idx = next.indexOf(a.id);
      const byId = new Map(columns.map((c) => [c.id, c]));
      const position = between(byId.get(next[idx - 1]), byId.get(next[idx + 1]));
      applyColumns(
        groupId,
        columns.map((c) => (c.id === a.id ? { ...c, position } : c)).sort((x, y) => x.position - y.position)
      );
      tryMutate(api('PATCH', `/api/groups/${groupId}/columns/${a.id}`, { position }), { errorTitle: 'Could not reorder columns' }).then((r) => {
        if (r === undefined) fetchGroup(groupId).catch(() => {});
      });
      return;
    }

    if (!canDrag || !snapshot) return;
    const taskId = a.id;
    const destColId = o.type === 'column' ? o.id : o.columnId;
    // Final visible order of the destination column, with the card at its landing index
    let list = [...(snapshot[destColId] || [])];
    if (o.type === 'task' && o.id !== taskId) {
      const from = list.indexOf(taskId);
      const to = list.indexOf(o.id);
      list = from >= 0 ? arrayMove(list, from, to) : [...list.slice(0, to + 1), taskId, ...list.slice(to + 1)];
    } else if (!list.includes(taskId)) {
      list.push(taskId);
    }
    const idx = list.indexOf(taskId);
    const task = taskById.get(taskId);
    if (!task) return;
    if (task.columnId === destColId && visibleOrder[destColId]?.indexOf(taskId) === idx) return; // dropped where it was

    // The landing index refers to the VISIBLE list, but positions must be
    // computed against the FULL column — hidden (filtered-out) cards still
    // occupy positions, and colliding with them corrupts the order.
    const all = tasksIn(destColId, false).filter((t) => t.id !== taskId);
    const beforeVis = taskById.get(list[idx - 1]);
    const afterVis = taskById.get(list[idx + 1]);
    let before: Task | undefined;
    let after: Task | undefined;
    if (beforeVis) {
      before = beforeVis;
      after = all[all.findIndex((t) => t.id === beforeVis.id) + 1];
    } else if (afterVis) {
      const ai = all.findIndex((t) => t.id === afterVis.id);
      before = all[ai - 1];
      after = afterVis;
    } else {
      before = all[all.length - 1];
    }
    const position = between(before, after);
    moveTaskLocal(taskId, groupId, destColId, position);
    tryMutate(api('PATCH', `/api/tasks/${taskId}/move`, { columnId: destColId, position }), { errorTitle: 'Could not move the task' }).then((r) => {
      if (r === undefined) fetchGroup(groupId).catch(() => {});
    });
  }

  // ---- other actions ----

  async function createTask(colId: number, keepOpen = false) {
    const title = newTitle.trim();
    if (!title) {
      if (!keepOpen) setAddingTo(null);
      return;
    }
    setNewTitle('');
    if (!keepOpen) setAddingTo(null);
    await tryMutate(api('POST', `/api/groups/${groupId}/tasks`, { title, columnId: colId }), {
      errorTitle: 'Could not add the task',
    });
  }

  function markDone(task: Task) {
    const done = columns.find((c) => c.isDone);
    if (!done) {
      toast({ kind: 'info', title: 'No completed column', body: 'Ask a group admin to mark a column as "counts as completed".' });
      return;
    }
    const max = tasksIn(done.id, false).reduce((m, t) => Math.max(m, t.position), 0);
    moveTaskLocal(task.id, groupId, done.id, max + 1);
    tryMutate(api('PATCH', `/api/tasks/${task.id}/move`, { columnId: done.id, position: max + 1 }), {
      errorTitle: 'Could not complete the task',
    }).then((r) => {
      if (r === undefined) fetchGroup(groupId).catch(() => {});
    });
  }

  function assignMe(task: Task) {
    if (!me) return;
    tryMutate(api('PATCH', `/api/tasks/${task.id}`, { assigneeIds: [...task.assignees, me.id] }), {
      success: 'Assigned to you',
      errorTitle: 'Could not assign the task',
    });
  }

  async function renameColumn(col: Column) {
    const name = renameVal.trim();
    setRenaming(null);
    if (!name || name === col.name) return;
    await tryMutate(api('PATCH', `/api/groups/${groupId}/columns/${col.id}`, { name }), {
      errorTitle: 'Could not rename the column',
    });
  }

  async function toggleDone(col: Column) {
    setMenuFor(null);
    await tryMutate(api('PATCH', `/api/groups/${groupId}/columns/${col.id}`, { isDone: !col.isDone }), {
      errorTitle: 'Could not update the column',
    });
  }

  async function deleteColumn(col: Column) {
    setMenuFor(null);
    const ok = await ask({
      title: `Delete column “${col.name}”?`,
      body: 'Its tasks move to the first column. This cannot be undone.',
      confirmLabel: 'Delete column',
      danger: true,
    });
    if (!ok) return;
    await tryMutate(api('DELETE', `/api/groups/${groupId}/columns/${col.id}`), {
      success: 'Column deleted',
      errorTitle: 'Could not delete the column',
    });
  }

  async function addColumn() {
    const name = newColName.trim();
    setNewColName('');
    setAddingColumn(false);
    if (!name) return;
    await tryMutate(api('POST', `/api/groups/${groupId}/columns`, { name }), {
      errorTitle: 'Could not add the column',
    });
  }

  const totalTasks = gd.tasks.length;
  const doneTasks = gd.tasks.filter((t) => t.completedAt).length;
  const activeTask = active?.type === 'task' ? taskById.get(active.id) : undefined;
  const activeColumn = active?.type === 'column' ? columns.find((c) => c.id === active.id) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Mobile column pager: one column per swipe, tap to jump */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 md:hidden" role="tablist" aria-label="Columns">
        {columns.map((col) => {
          const n = (order[col.id] || []).length;
          const isActive = (activeCol ?? columns[0]?.id) === col.id;
          return (
            <button
              key={col.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => scrollToColumn(col.id)}
              className={cx(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition',
                isActive ? 'border-ink-900 bg-ink-900 text-panel' : 'border-line bg-panel text-ink-500'
              )}
            >
              {col.name}
              <span className={cx('tabular-nums', isActive ? 'opacity-80' : 'text-ink-400')}>{n}</span>
            </button>
          );
        })}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div
          ref={scrollerRef}
          className="thin-scroll flex min-h-0 flex-1 snap-x snap-mandatory items-start gap-4 overflow-x-auto px-4 pb-6 md:snap-none lg:px-6"
        >
          <SortableContext items={columns.map((c) => colKey(c.id))} strategy={horizontalListSortingStrategy}>
            {columns.map((col) => (
              <BoardColumn
                key={col.id}
                col={col}
                taskIds={order[col.id] || []}
                taskById={taskById}
                hiddenCount={filtering ? tasksIn(col.id, false).length - (visibleOrder[col.id] || []).length : 0}
                isAdmin={isAdmin}
                canEdit={canEdit}
                canDrag={canDrag}
                filtering={filtering}
                dragging={active !== null}
                totalTasks={totalTasks}
                doneTasks={doneTasks}
                renaming={renaming}
                renameVal={renameVal}
                setRenameVal={setRenameVal}
                setRenaming={setRenaming}
                renameColumn={renameColumn}
                menuFor={menuFor}
                setMenuFor={setMenuFor}
                toggleDone={toggleDone}
                deleteColumn={deleteColumn}
                openTaskModal={openTaskModal}
                markDone={markDone}
                assignMe={assignMe}
                addingTo={addingTo}
                setAddingTo={setAddingTo}
                newTitle={newTitle}
                setNewTitle={setNewTitle}
                createTask={createTask}
              />
            ))}
          </SortableContext>

          {isAdmin && (
            <div className="w-[86vw] shrink-0 snap-center sm:w-64">
              {addingColumn ? (
                <input
                  autoFocus
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  onBlur={addColumn}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addColumn();
                    if (e.key === 'Escape') setAddingColumn(false);
                  }}
                  placeholder="Column name…"
                  aria-label="New column name"
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
              ) : (
                <button
                  onClick={() => setAddingColumn(true)}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm font-medium text-ink-500 transition hover:border-ink-300 hover:text-ink-900"
                >
                  <Plus size={15} /> Add column
                </button>
              )}
            </div>
          )}
        </div>

        {/* The moving thing follows the pointer; the drop is instant (no drop animation). */}
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div data-drag-overlay className="cursor-grabbing rounded-lg shadow-lg ring-2 ring-ink-300">
              <TaskCard task={activeTask} onOpen={() => {}} focusable={false} />
            </div>
          ) : activeColumn ? (
            <div data-drag-overlay className="w-72 cursor-grabbing rounded-2xl bg-paper px-3 py-3 shadow-lg ring-2 ring-ink-300">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-500">{activeColumn.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One column: a sortable item among columns (admins drag its header) and the
// drop container for tasks.
// ---------------------------------------------------------------------------

function BoardColumn(props: {
  col: Column;
  taskIds: number[];
  taskById: Map<number, Task>;
  hiddenCount: number;
  isAdmin: boolean;
  canEdit: boolean;
  canDrag: boolean;
  filtering: boolean;
  dragging: boolean;
  totalTasks: number;
  doneTasks: number;
  renaming: number | null;
  renameVal: string;
  setRenameVal: (v: string) => void;
  setRenaming: (id: number | null) => void;
  renameColumn: (col: Column) => void;
  menuFor: number | null;
  setMenuFor: (id: number | null) => void;
  toggleDone: (col: Column) => void;
  deleteColumn: (col: Column) => void;
  openTaskModal: (id: number) => Promise<void>;
  markDone: (task: Task) => void;
  assignMe: (task: Task) => void;
  addingTo: number | null;
  setAddingTo: (id: number | null) => void;
  newTitle: string;
  setNewTitle: (v: string) => void;
  createTask: (colId: number, keepOpen?: boolean) => void;
}) {
  const { col, taskIds, taskById, hiddenCount, isAdmin, canEdit, canDrag, filtering, dragging, totalTasks, doneTasks } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id: colKey(col.id),
    data: { type: 'column', id: col.id } satisfies DragData,
    disabled: !isAdmin,
    transition: FAST,
  });
  // A task hovering over this column (directly, or over one of its cards)
  const activeData = active?.data.current as DragData | undefined;
  const taskOver = activeData?.type === 'task' && (isOver || taskIds.includes(activeData.id)) && activeData.columnId !== col.id;
  const dot = col.isDone ? 'var(--color-success)' : 'var(--color-ink-300)';
  const tasks = taskIds.map((id) => taskById.get(id)).filter((t): t is Task => !!t);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, maxHeight: '100%' }}
      id={`col-${col.id}`}
      data-col-id={col.id}
      className={cx(
        'flex w-[86vw] shrink-0 snap-center flex-col rounded-2xl bg-paper sm:w-80 md:w-72',
        isDragging && 'opacity-40',
        taskOver && 'ring-1 ring-inset ring-ink-300'
      )}
    >
      <div
        ref={setActivatorNodeRef}
        {...(isAdmin ? { ...attributes, ...listeners, role: undefined } : {})}
        className={cx('flex items-center gap-2 px-3 pb-1 pt-3', isAdmin && 'cursor-grab active:cursor-grabbing')}
      >
        {isAdmin && <GripVertical size={13} className="shrink-0 text-ink-300" aria-hidden />}
        {props.renaming === col.id ? (
          <input
            autoFocus
            value={props.renameVal}
            onChange={(e) => props.setRenameVal(e.target.value)}
            onBlur={() => props.renameColumn(col)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.renameColumn(col);
              if (e.key === 'Escape') props.setRenaming(null);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full rounded-md border border-ink-900 bg-panel px-2 py-0.5 text-sm font-semibold focus:outline-none"
          />
        ) : (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-500">{col.name}</h3>
            {col.isDone &&
              (totalTasks > 0 ? (
                <ProgressRing value={(doneTasks / totalTasks) * 100} size={18} stroke={3}>
                  <Check size={9} className="text-success" />
                </ProgressRing>
              ) : (
                <Check size={13} className="text-success" />
              ))}
            <Count value={tasks.length} muted={hiddenCount} />
          </>
        )}
        {isAdmin && props.renaming !== col.id && (
          <div className="relative ml-auto" onPointerDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => props.setMenuFor(props.menuFor === col.id ? null : col.id)}
              className="rounded-md p-1 text-ink-400 hover:bg-panel"
              aria-label={`Column options for ${col.name}`}
            >
              <MoreHorizontal size={15} />
            </button>
            {props.menuFor === col.id && (
              <div className="anim-in absolute right-0 top-7 z-20 w-48 rounded-xl border border-line bg-panel p-1 shadow-pop">
                <button
                  onClick={() => {
                    props.setMenuFor(null);
                    props.setRenaming(col.id);
                    props.setRenameVal(col.name);
                  }}
                  className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-paper"
                >
                  Rename
                </button>
                <button onClick={() => props.toggleDone(col)} className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-paper">
                  {col.isDone ? "Doesn't count as completed" : 'Counts as completed'}
                </button>
                <button
                  onClick={() => props.deleteColumn(col)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-urgent hover:bg-urgent-soft"
                >
                  <Trash2 size={13} /> Delete column
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <SortableContext items={taskIds.map(taskKey)} strategy={verticalListSortingStrategy}>
        <div className="thin-scroll min-h-16 flex-1 space-y-2 overflow-y-auto p-2">
          {tasks.map((task) => (
            <SortableTask key={task.id} task={task} columnId={col.id} canDrag={canDrag} onOpen={() => props.openTaskModal(task.id)}>
              <TaskCard
                task={task}
                canEdit={canEdit}
                focusable={false}
                onOpen={() => props.openTaskModal(task.id)}
                onMarkDone={col.isDone ? undefined : () => props.markDone(task)}
                onAssignMe={() => props.assignMe(task)}
              />
            </SortableTask>
          ))}
          {tasks.length === 0 && (
            <p
              className={cx(
                'rounded-xl border border-dashed px-3 py-4 text-center text-xs transition-colors',
                taskOver ? 'border-ink-300 text-ink-500' : 'border-line text-ink-300'
              )}
            >
              {filtering ? 'No matching cards' : canDrag ? (dragging ? 'Drop here' : 'Drop a card here') : 'Nothing here yet'}
            </p>
          )}
        </div>
      </SortableContext>

      {canEdit && (
        <div className="p-2 pt-0">
          {props.addingTo === col.id ? (
            <div className="anim-in">
              <input
                autoFocus
                value={props.newTitle}
                onChange={(e) => props.setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.createTask(col.id, e.ctrlKey || e.metaKey);
                  if (e.key === 'Escape') {
                    props.setAddingTo(null);
                    props.setNewTitle('');
                  }
                }}
                placeholder="Task title…"
                aria-label="New task title"
                className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
              <p className="mt-1 flex items-center gap-1 px-1 text-[10px] text-ink-400">
                <Kbd>Enter</Kbd> add · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> add another · <Kbd>Esc</Kbd> cancel
              </p>
            </div>
          ) : (
            <button
              onClick={() => {
                props.setAddingTo(col.id);
                props.setNewTitle('');
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-ink-500 transition hover:bg-panel hover:text-ink-900"
            >
              <Plus size={15} /> Add task
            </button>
          )}
        </div>
      )}
    </div>
  );
}
