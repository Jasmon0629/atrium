import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { api, mutate, tryMutate } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAuth } from '../../stores/auth';
import { useData, useRecent } from '../../stores/data';
import { useConfirm } from '../ConfirmDialog';
import { Avatar, Button, Kbd, Modal, PriorityBadge, cx } from '../ui';
import type { Priority } from '../../lib/types';

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

export function TaskModal() {
  const openTask = useData((s) => s.openTask);
  const closeTaskModal = useData((s) => s.closeTaskModal);
  const groups = useData((s) => s.groups);
  const groupData = useData((s) => s.groupData);
  const fetchGroup = useData((s) => s.fetchGroup);
  const moveTaskLocal = useData((s) => s.moveTaskLocal);
  const users = useData((s) => s.users);
  const me = useAuth((s) => s.user);
  const ask = useConfirm();

  const task = openTask?.task;
  const groupId = task?.groupId;
  const recent = useRecent(task?.id ?? -1);

  // Editable draft state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [tags, setTags] = useState('');
  const [progress, setProgress] = useState(0);
  const [assignees, setAssignees] = useState<number[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [checkLabel, setCheckLabel] = useState('');

  // Seed the draft from the task, and re-seed on live updates from other
  // users as long as this user hasn't started editing (dirty).
  useEffect(() => {
    if (!task || dirty) return;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setDueDate(task.dueDate || '');
    setStartDate(task.startDate || '');
    setTags(task.tags.join(', '));
    setProgress(task.progress);
    setAssignees(task.assignees);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, dirty]);

  useEffect(() => {
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  useEffect(() => {
    if (groupId && !groupData[groupId]) fetchGroup(groupId).catch(() => {});
  }, [groupId, groupData, fetchGroup]);

  const role = useMemo(() => groups.find((g) => g.id === groupId)?.role, [groups, groupId]);
  const canEdit = role === 'member' || role === 'admin' || !!me?.isSuperAdmin;
  const canDelete = role === 'admin' || me?.isSuperAdmin || task?.createdBy === me?.id;
  const members = groupId ? groupData[groupId]?.members || [] : [];
  const columns = groupId ? [...(groupData[groupId]?.columns || [])].sort((a, b) => a.position - b.position) : [];
  const column = columns.find((c) => c.id === task?.columnId);

  if (!openTask || !task) return null;

  function markDirty() {
    setDirty(true);
  }

  // Moving from the modal: the reliable path on phones, where drag is fiddly
  function moveToColumn(columnId: number) {
    if (!task || !groupId || columnId === task.columnId) return;
    const target = columns.find((c) => c.id === columnId);
    const max = (groupData[groupId]?.tasks || [])
      .filter((t) => t.columnId === columnId)
      .reduce((m, t) => Math.max(m, t.position), 0);
    moveTaskLocal(task.id, groupId, columnId, max + 1);
    tryMutate(api('PATCH', `/api/tasks/${task.id}/move`, { columnId, position: max + 1 }), {
      errorTitle: 'Could not move the task',
    }).then((r) => {
      if (r === undefined) fetchGroup(groupId).catch(() => {});
    });
  }

  async function requestClose() {
    if (dirty) {
      const ok = await ask({
        title: 'Discard unsaved changes?',
        body: 'Your edits to this task have not been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!ok) return;
    }
    closeTaskModal();
  }

  async function save() {
    if (!task || !dirty || saving) return;
    setSaving(true);
    try {
      // Send only fields this user actually changed, so a stale draft can
      // never silently overwrite a teammate's concurrent edits.
      const payload: Record<string, unknown> = {};
      if (title !== task.title) payload.title = title;
      if (description !== task.description) payload.description = description;
      if (priority !== task.priority) payload.priority = priority;
      if ((dueDate || null) !== task.dueDate) payload.dueDate = dueDate || null;
      if ((startDate || null) !== task.startDate) payload.startDate = startDate || null;
      const tagArr = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (JSON.stringify(tagArr) !== JSON.stringify(task.tags)) payload.tags = tagArr;
      if (progress !== task.progress) payload.progress = progress;
      const a = [...assignees].sort((x, y) => x - y);
      const b = [...task.assignees].sort((x, y) => x - y);
      if (JSON.stringify(a) !== JSON.stringify(b)) payload.assigneeIds = assignees;
      if (Object.keys(payload).length > 0) {
        await mutate(api('PATCH', `/api/tasks/${task.id}`, payload), { errorTitle: 'Could not save the task' });
      }
      setDirty(false);
    } catch {
      // toast already shown by mutate; keep the draft so nothing is lost
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!task) return;
    const ok = await ask({
      title: 'Delete this task?',
      body: 'It is removed for everyone in the group, together with its checklist and discussion.',
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (!ok) return;
    const r = await tryMutate(api('DELETE', `/api/tasks/${task.id}`), {
      success: 'Task deleted',
      errorTitle: 'Could not delete the task',
    });
    if (r !== undefined) closeTaskModal();
  }

  async function addComment(e: FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body || !task) return;
    setComment('');
    const r = await tryMutate(api('POST', `/api/tasks/${task.id}/comments`, { body }), {
      errorTitle: 'Could not post the comment',
    });
    if (r === undefined) setComment(body); // give the text back on failure
  }

  async function addCheck(e: FormEvent) {
    e.preventDefault();
    const label = checkLabel.trim();
    if (!label || !task) return;
    setCheckLabel('');
    await tryMutate(api('POST', `/api/tasks/${task.id}/checklist`, { label }), {
      errorTitle: 'Could not add the checklist item',
    });
  }

  const creator = users[task.createdBy];
  const editor = recent?.actorId && recent.actorId !== me?.id ? users[recent.actorId] : undefined;
  const overdue = !!task.dueDate && !task.completedAt && task.dueDate < new Date().toISOString().slice(0, 10);
  const checklistDone = openTask.checklist.filter((c) => c.done).length;

  return (
    <Modal onClose={requestClose} variant="drawer" labelledBy="task-modal-title">
      <div
        className="grid max-h-[85vh] gap-0 overflow-y-auto md:grid-cols-5"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canEdit && dirty) {
            e.preventDefault();
            save();
          }
        }}
      >
        {/* Left: main fields + discussion */}
        <div className="p-6 md:col-span-3">
          {canEdit ? (
            <input
              id="task-modal-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                markDirty();
              }}
              aria-label="Task title"
              className="w-full rounded-lg border border-transparent bg-transparent text-xl font-semibold transition focus:border-line focus:bg-paper"
            />
          ) : (
            <h2 id="task-modal-title" className="text-xl font-semibold">
              {task.title}
            </h2>
          )}
          <p className="mt-1 text-xs text-ink-400">
            {column ? `${column.name} · ` : ''}created by {creator?.name || 'unknown'} ·{' '}
            {timeAgo(task.createdAt)}
          </p>

          {editor && (
            <p className="anim-in mt-3 flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink-700">
              <Avatar name={editor.name} color={editor.avatarColor} size={18} />
              <span>
                <strong>{editor.name.split(' ')[0]}</strong> {recent?.kind === 'commented' ? 'commented' : 'updated this task'} just now.
                {dirty && ' Your unsaved edits are kept — saving sends only the fields you changed.'}
              </span>
              <RefreshCw size={12} className="ml-auto shrink-0" aria-hidden />
            </p>
          )}

          <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-ink-500">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty();
            }}
            disabled={!canEdit}
            rows={3}
            placeholder={canEdit ? 'Add a description…' : 'No description'}
            className="mt-1 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-70"
          />

          {/* Checklist */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Checklist {openTask.checklist.length > 0 && `· ${checklistDone}/${openTask.checklist.length}`}
              </label>
            </div>
            {openTask.checklist.length > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper">
                <div
                  className="h-full rounded-full bg-ink-700"
                  style={{
                    width: `${(checklistDone / openTask.checklist.length) * 100}%`,
                    transition: 'width 0.5s var(--ease-soft)',
                  }}
                />
              </div>
            )}
            <ul className="mt-2 space-y-1">
              {openTask.checklist.map((item) => (
                <li key={item.id} className="group flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-paper">
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={!canEdit}
                    onChange={() =>
                      tryMutate(
                        api('PATCH', `/api/tasks/${task.id}/checklist/${item.id}`, { done: !item.done }),
                        { errorTitle: 'Could not update the checklist' }
                      )
                    }
                    className="h-4 w-4 accent-ink-900"
                    aria-label={item.label}
                  />
                  <span className={cx('flex-1 text-sm transition', item.done && 'text-ink-400 line-through')}>
                    {item.label}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() =>
                        tryMutate(api('DELETE', `/api/tasks/${task.id}/checklist/${item.id}`), {
                          errorTitle: 'Could not remove the item',
                        })
                      }
                      className="rounded p-0.5 text-ink-300 opacity-0 transition hover:text-urgent group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="Remove item"
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <form onSubmit={addCheck} className="mt-2 flex items-center gap-2">
                <Plus size={14} className="text-ink-400" />
                <input
                  value={checkLabel}
                  onChange={(e) => setCheckLabel(e.target.value)}
                  placeholder="Add checklist item…"
                  aria-label="New checklist item"
                  className="flex-1 rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm transition focus:border-line focus:bg-paper"
                />
              </form>
            )}
          </div>

          {/* Comments */}
          <div className="mt-6 border-t border-line pt-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Discussion · {openTask.comments.length}
            </label>
            <ul className="mt-3 space-y-3">
              {openTask.comments.map((c) => {
                const u = users[c.userId];
                const mine = c.userId === me?.id;
                return (
                  <li key={c.id} className="anim-in flex gap-2.5">
                    {u && <Avatar name={u.name} color={u.avatarColor} size={28} />}
                    <div className={cx('min-w-0 flex-1 rounded-xl px-3 py-2', mine ? 'border border-line bg-panel' : 'bg-paper')}>
                      <p className="text-xs">
                        <span className="font-semibold">{u?.name || 'Unknown'}</span>{' '}
                        <span className="text-ink-400">· {timeAgo(c.createdAt)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {canEdit && (
              <form onSubmit={addComment} className="mt-3 flex items-center gap-2">
                {me && <Avatar name={me.name} color={me.avatarColor} size={28} />}
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment…"
                  aria-label="Write a comment"
                  className="flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
                <button
                  type="submit"
                  className="btn-brand rounded-md p-2 text-white"
                  aria-label="Send comment"
                >
                  <Send size={15} />
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Right: metadata rail */}
        <div className="space-y-4 border-t border-line bg-paper/60 p-6 md:col-span-2 md:border-l md:border-t-0">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">Priority</label>
            {canEdit ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setPriority(p);
                      markDirty();
                    }}
                    className={cx(
                      'rounded-full border px-2 py-0.5 transition',
                      priority === p ? 'border-ink-900 bg-paper' : 'border-transparent opacity-60 hover:opacity-100'
                    )}
                    aria-pressed={priority === p}
                  >
                    <PriorityBadge priority={p} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-1.5">
                <PriorityBadge priority={task.priority} />
              </div>
            )}
          </div>

          {canEdit && columns.length > 0 && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-500" htmlFor="task-column">
                Column
              </label>
              <select
                id="task-column"
                value={task.columnId}
                onChange={(e) => moveToColumn(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isDone ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">Start</label>
              <input
                type="date"
                value={startDate}
                disabled={!canEdit}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  markDirty();
                }}
                className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">Due</label>
              <input
                type="date"
                value={dueDate}
                disabled={!canEdit}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  markDirty();
                }}
                className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Assignees
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {members.map((m) => {
                const selected = assignees.includes(m.id);
                return (
                  <button
                    key={m.id}
                    disabled={!canEdit}
                    onClick={() => {
                      setAssignees(selected ? assignees.filter((a) => a !== m.id) : [...assignees, m.id]);
                      markDirty();
                    }}
                    className={cx(
                      'flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs font-medium transition disabled:cursor-default',
                      selected
                        ? 'border-ink-900 bg-paper text-ink-900'
                        : 'border-line bg-panel text-ink-500 hover:bg-paper'
                    )}
                    aria-pressed={selected}
                  >
                    <Avatar name={m.name} color={m.avatarColor} size={18} />
                    {m.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">Tags</label>
            <input
              value={tags}
              disabled={!canEdit}
              onChange={(e) => {
                setTags(e.target.value);
                markDirty();
              }}
              placeholder="comma, separated"
              className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-500">
              Progress <span className="font-mono text-ink-900">{progress}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              disabled={!canEdit}
              onChange={(e) => {
                setProgress(Number(e.target.value));
                markDirty();
              }}
              className="mt-1.5 w-full accent-ink-900"
              aria-label="Progress"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            {canEdit && (
              // The accent only appears when there is something to do: a clean task shows a quiet "Saved".
              <Button onClick={save} variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={saving} className="flex-1">
                {dirty ? 'Save changes' : 'Saved'}
              </Button>
            )}
            {canDelete && (
              <Button variant="danger" onClick={remove} aria-label="Delete task" title="Delete task" className="px-2.5">
                <Trash2 size={16} />
              </Button>
            )}
          </div>
          {canEdit && (
            <p className="flex items-center gap-1 text-[10px] text-ink-400">
              <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> saves · <Kbd>Esc</Kbd> closes
            </p>
          )}

          {overdue && (
            <p className="flex items-center gap-1.5 rounded-xl bg-urgent-soft px-3 py-2 text-xs font-semibold text-urgent">
              <CalendarDays size={13} /> This task is overdue
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
