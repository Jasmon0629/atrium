import { Fragment, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ArrowDown, Clock, CornerUpLeft, Mic, Send, Smile, SmilePlus, X } from 'lucide-react';
import { useSpeechToText } from '../../lib/useSpeech';
import { emitTyping } from '../../lib/socket';
import { formatDayLabel, formatTime } from '../../lib/format';
import { useAuth } from '../../stores/auth';
import { useData } from '../../stores/data';
import { Avatar, Kbd, cx } from '../ui';
import type { Message, Room } from '../../lib/types';

const EMOJI = ['👍', '✅', '🎉', '😀', '😂', '🙏', '🔥', '❤️', '👀', '🚀', '☕', '📌', '💯', '🤔', '👏', '🙌', '😅', '😍', '😎', '🥳', '🤝', '📣', '⏰', '✨'];
const RECENT_KEY = 'atrium-emoji-recent';
const GROUP_GAP_MS = 5 * 60 * 1000;
const QUICK_REACTIONS = ['👍', '✅', '🎉', '❤️', '😂', '👀', '🔥', '🙏'];

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function ChatRoomView({ room, readOnly }: { room: Room; readOnly?: boolean }) {
  const me = useAuth((s) => s.user);
  const messages = useData((s) => s.messages[room.id]);
  const typing = useData((s) => s.typing[room.id]);
  const users = useData((s) => s.users);
  const fetchMessages = useData((s) => s.fetchMessages);
  const setActiveRoom = useData((s) => s.setActiveRoom);
  const markRoomRead = useData((s) => s.markRoomRead);
  const sendMessage = useData((s) => s.sendMessage);
  const toggleReaction = useData((s) => s.toggleReaction);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [unseen, setUnseen] = useState(0);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const speech = useSpeechToText((spoken) => setText((t) => (t ? t + ' ' : '') + spoken));
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const lastTypingSent = useRef(0);
  const prevLen = useRef(0);

  useEffect(() => {
    fetchMessages(room.id).catch(() => {});
    setActiveRoom(room.id);
    markRoomRead(room.id).catch(() => {});
    return () => setActiveRoom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  const list = messages || [];

  // Follow new messages only while the reader is at (or near) the bottom —
  // never yank someone away from scrolled-up history; count what they missed.
  useEffect(() => {
    const len = list.length;
    const added = len - prevLen.current;
    prevLen.current = len;
    const lastIsMine = list[len - 1]?.userId === me?.id;
    if (stickToBottom.current || (added > 0 && lastIsMine)) {
      stickToBottom.current = true;
      bottomRef.current?.scrollIntoView({ block: 'end' });
      setUnseen(0);
    } else if (added > 0) {
      setUnseen((u) => u + added);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length, typing?.length]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = atBottom;
    if (atBottom) setUnseen(0);
  }

  function scrollToBottom() {
    stickToBottom.current = true;
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    setUnseen(0);
  }

  // Prune stale typing indicators every second
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    const reply = replyTo;
    setReplyTo(null);
    setShowEmoji(false);
    requestAnimationFrame(autoGrow);
    const ok = await sendMessage(room.id, body, reply);
    if (!ok) {
      // give the text back so nothing is lost
      setText(body);
      setReplyTo(reply);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      if (showEmoji) setShowEmoji(false);
      else if (replyTo) setReplyTo(null);
    }
  }

  function onType(v: string) {
    setText(v);
    autoGrow();
    const now = Date.now();
    if (now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now;
      emitTyping(room.id);
    }
  }

  function pickEmoji(e: string) {
    setText((t) => t + e);
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
    taRef.current?.focus();
  }

  function jumpTo(id: number) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightId(id);
    setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 1600);
  }

  const activeTyping = (typing || []).filter((t) => t.until > Date.now());
  let lastDay = '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollerRef} onScroll={onScroll} className="thin-scroll flex-1 overflow-y-auto px-4 py-3">
          {list.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-400">No messages yet — say hello</p>
          )}
          {list.map((m, i) => {
            const day = formatDayLabel(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const prev = list[i - 1];
            const gap = prev ? new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() : Infinity;
            const mine = m.userId === me?.id;
            const grouped = !showDay && prev?.userId === m.userId && gap < GROUP_GAP_MS;
            const sender = users[m.userId];
            return (
              <Fragment key={m.id}>
                {showDay && (
                  <div className="my-3 flex items-center gap-3">
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{day}</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div
                  id={`msg-${m.id}`}
                  className={cx(
                    'group flex gap-2.5 rounded-2xl',
                    grouped ? 'mt-0.5' : 'mt-3',
                    mine && 'flex-row-reverse',
                    !mine && 'anim-in',
                    highlightId === m.id && 'flash'
                  )}
                >
                  {!grouped ? (
                    sender && <Avatar name={sender.name} color={sender.avatarColor} size={30} online={sender.online} />
                  ) : (
                    <span
                      className={cx(
                        'flex w-[30px] shrink-0 items-center justify-center text-[10px] text-ink-300 opacity-0 transition group-hover:opacity-100',
                        mine && 'invisible'
                      )}
                    >
                      {formatTime(m.createdAt)}
                    </span>
                  )}
                  <div className={cx('min-w-0 max-w-[75%]', mine && 'text-right')}>
                    {!grouped && (
                      <p className={cx('mb-0.5 text-[11px] text-ink-400', mine && 'text-right')}>
                        <span className="font-semibold text-ink-700">{mine ? 'You' : sender?.name}</span> ·{' '}
                        {formatTime(m.createdAt)}
                      </p>
                    )}
                    {m.replyTo && (
                      <button
                        onClick={() => jumpTo(m.replyTo!.id)}
                        className={cx(
                          'mb-0.5 block max-w-full truncate rounded-lg border-l-2 border-ink-300 bg-paper px-2 py-1 text-left text-[11px] text-ink-500 hover:bg-line hover:text-ink-900',
                          mine && 'ml-auto'
                        )}
                        title="Jump to the original message"
                      >
                        ↪ {users[m.replyTo.userId]?.name}: {m.replyTo.body}
                      </button>
                    )}
                    <div className={cx('flex items-center gap-1', mine && 'flex-row-reverse')}>
                      <div
                        className={cx(
                          'inline-block whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-left text-sm transition',
                          mine ? 'bg-ink-900 text-panel' : 'border border-line bg-panel',
                          m.pending && 'opacity-60'
                        )}
                      >
                        {m.body}
                      </div>
                      {m.pending ? (
                        <Clock size={12} className="text-ink-300" aria-label="Sending" />
                      ) : (
                        <span className={cx('relative flex items-center', mine && 'flex-row-reverse')}>
                          <button
                            onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                            className={cx(
                              'rounded p-1 text-ink-300 transition hover:text-ink-900 group-hover:opacity-100 focus-visible:opacity-100',
                              reactFor === m.id ? 'opacity-100 text-ink-900' : 'opacity-0'
                            )}
                            title="React"
                            aria-label="Add reaction"
                            aria-expanded={reactFor === m.id}
                          >
                            <SmilePlus size={13} />
                          </button>
                          {!readOnly && (
                            <button
                              onClick={() => {
                                setReplyTo(m);
                                taRef.current?.focus();
                              }}
                              className="rounded p-1 text-ink-300 opacity-0 transition hover:text-ink-900 group-hover:opacity-100 focus-visible:opacity-100"
                              title="Reply"
                              aria-label="Reply to message"
                            >
                              <CornerUpLeft size={13} />
                            </button>
                          )}
                          {reactFor === m.id && (
                            <div
                              className={cx(
                                'anim-in absolute top-full z-20 mt-1 flex gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-pop',
                                mine ? 'right-0' : 'left-0'
                              )}
                              role="menu"
                              aria-label="Quick reactions"
                            >
                              {QUICK_REACTIONS.map((e) => (
                                <button
                                  key={e}
                                  role="menuitem"
                                  onClick={() => {
                                    toggleReaction(m, e);
                                    setReactFor(null);
                                  }}
                                  className="rounded-lg px-1.5 py-0.5 text-base transition hover:scale-125 hover:bg-paper"
                                  aria-label={`React with ${e}`}
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                          )}
                        </span>
                      )}
                    </div>
                    {m.reactions && m.reactions.length > 0 && (
                      <div className={cx('mt-1 flex flex-wrap gap-1', mine && 'justify-end')}>
                        {m.reactions.map((r) => {
                          const mineToo = !!me && r.userIds.includes(me.id);
                          const who = r.userIds.map((id) => users[id]?.name.split(' ')[0]).filter(Boolean).join(', ');
                          return (
                            <button
                              key={r.emoji}
                              onClick={() => toggleReaction(m, r.emoji)}
                              title={who}
                              aria-label={`${r.emoji} ${r.count}: ${who}`}
                              aria-pressed={mineToo}
                              className={cx(
                                'anim-in flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition',
                                mineToo
                                  ? 'border-ink-900 bg-paper text-ink-900'
                                  : 'border-line bg-panel text-ink-600 hover:bg-paper'
                              )}
                            >
                              <span>{r.emoji}</span>
                              <span key={r.count} className="count-pop font-semibold tabular-nums">
                                {r.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
          {activeTyping.length > 0 && (
            <div className="anim-in mt-3 flex items-center gap-2 pl-10">
              <span className="flex items-center gap-1 rounded-lg border border-line bg-panel px-3 py-2.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-ink-400" />
                ))}
              </span>
              <span className="text-xs text-ink-400">
                {activeTyping.map((t) => t.name.split(' ')[0]).join(', ')} {activeTyping.length === 1 ? 'is' : 'are'} typing
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {unseen > 0 && (
          <button
            onClick={scrollToBottom}
            className="anim-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink-900 px-3.5 py-1.5 text-xs font-medium text-panel"
          >
            <ArrowDown size={13} /> {unseen} new message{unseen > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {!readOnly && (
        <div className="border-t border-line bg-panel p-3">
          {replyTo && (
            <div className="anim-in mb-2 flex items-center gap-2 rounded-lg bg-paper px-3 py-1.5 text-xs text-ink-500">
              <CornerUpLeft size={12} />
              <span className="truncate">
                Replying to <b>{users[replyTo.userId]?.name}</b>: {replyTo.body}
              </span>
              <button onClick={() => setReplyTo(null)} className="ml-auto text-ink-400 hover:text-urgent" aria-label="Cancel reply">
                <X size={13} />
              </button>
            </div>
          )}
          {showEmoji && (
            <div className="anim-in mb-2 rounded-lg border border-line bg-panel p-2">
              {recent.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1 border-b border-line pb-1.5">
                  {recent.map((e) => (
                    <button key={e} onClick={() => pickEmoji(e)} className="rounded-lg p-1 text-lg hover:bg-paper" aria-label={`Insert ${e}`}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {EMOJI.map((e) => (
                  <button key={e} onClick={() => pickEmoji(e)} className="rounded-lg p-1 text-lg hover:bg-paper" aria-label={`Insert ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2"
          >
            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              className={cx('rounded-xl p-2 transition', showEmoji ? 'bg-paper text-ink-900' : 'text-ink-400 hover:bg-paper')}
              aria-label="Emoji"
              aria-pressed={showEmoji}
            >
              <Smile size={18} />
            </button>
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={speech.listening ? speech.interim || 'Listening…' : `Message ${room.name}…`}
              aria-label={`Message ${room.name}`}
              className="max-h-40 flex-1 resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-snug transition focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            {speech.supported && (
              <button
                type="button"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                className={cx(
                  'rounded-xl p-2 transition',
                  speech.listening ? 'live-dot bg-urgent-soft text-urgent' : 'text-ink-400 hover:bg-paper'
                )}
                title={speech.listening ? 'Stop listening' : 'Speak to type'}
                aria-label="Voice input"
                aria-pressed={speech.listening}
              >
                <Mic size={18} />
              </button>
            )}
            <button
              type="submit"
              disabled={!text.trim()}
              className="btn-brand rounded-md p-2 text-white disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </form>
          <p className="mt-1.5 hidden items-center gap-1 pl-11 text-[10px] text-ink-300 sm:flex">
            <Kbd>Enter</Kbd> send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
          </p>
        </div>
      )}
    </div>
  );
}
