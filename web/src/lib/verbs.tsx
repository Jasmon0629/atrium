import {
  ArrowRight,
  CheckCircle2,
  Megaphone,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface VerbStyle {
  icon: ReactNode;
  /** Tailwind classes for the small icon badge (background + text). */
  tone: string;
}

// Marks stay monochrome; only real state gets a tone (done = green, gone = red).
const QUIET = 'bg-paper text-ink-500';
const RULES: { match: RegExp; style: VerbStyle }[] = [
  { match: /created/, style: { icon: <Plus size={12} />, tone: QUIET } },
  { match: /moved/, style: { icon: <ArrowRight size={12} />, tone: QUIET } },
  { match: /comment/, style: { icon: <MessageSquare size={12} />, tone: QUIET } },
  { match: /deleted/, style: { icon: <Trash2 size={12} />, tone: 'bg-urgent-soft text-urgent' } },
  { match: /removed/, style: { icon: <UserMinus size={12} />, tone: 'bg-urgent-soft text-urgent' } },
  { match: /announce|posted|pinned/, style: { icon: <Megaphone size={12} />, tone: QUIET } },
  { match: /added|joined|assigned|invited/, style: { icon: <UserPlus size={12} />, tone: QUIET } },
  { match: /complete|done|finished/, style: { icon: <CheckCircle2 size={12} />, tone: 'bg-success-soft text-success' } },
  { match: /value/, style: { icon: <Wallet size={12} />, tone: QUIET } },
];

/** Icon + tone for an activity verb such as "moved task" or "commented on". */
export function verbStyle(verb: string): VerbStyle {
  return RULES.find((r) => r.match.test(verb))?.style || { icon: <Pencil size={12} />, tone: QUIET };
}
