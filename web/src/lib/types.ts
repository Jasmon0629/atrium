export type Role = 'admin' | 'member' | 'viewer';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type AnnPriority = 'urgent' | 'important' | 'general';

export interface User {
  id: number;
  name: string;
  email: string;
  avatarColor: string;
  department: string;
  title: string;
  isSuperAdmin: boolean;
  mustChangePassword?: boolean;
  disabled?: boolean;
  lastActiveAt: string | null;
  online?: boolean;
}

export interface Member extends User {
  role: Role;
}

export interface GroupSummary {
  id: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  isProject: boolean;
  value: number;
  valueUnit: string;
  role: Role | null;
  memberCount: number;
  taskTotal: number;
  taskDone: number;
  taskOverdue: number;
}

export interface Column {
  id: number;
  groupId: number;
  name: string;
  position: number;
  isDone: boolean;
}

export interface Task {
  id: number;
  groupId: number;
  columnId: number;
  title: string;
  description: string;
  priority: Priority;
  position: number;
  startDate: string | null;
  dueDate: string | null;
  tags: string[];
  progress: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assignees: number[];
  commentCount: number;
  checklistDone: number;
  checklistTotal: number;
}

export interface TaskComment {
  id: number;
  taskId: number;
  userId: number;
  body: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: number;
  taskId: number;
  label: string;
  done: boolean;
  position: number;
}

export interface Announcement {
  id: number;
  scope: 'company' | 'group';
  groupId: number | null;
  groupName: string | null;
  title: string;
  body: string;
  priority: AnnPriority;
  pinned: boolean;
  expiresAt: string | null;
  authorId: number;
  authorName: string;
  createdAt: string;
  read: boolean;
}

export interface Room {
  id: number;
  kind: 'group' | 'dm';
  groupId: number | null;
  name: string;
  icon: string;
  otherUserId: number | null;
  unread: number;
  lastMessage: { body: string; userId: number; createdAt: string } | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: number[];
}

export interface Message {
  id: number;
  roomId: number;
  userId: number;
  body: string;
  replyToId: number | null;
  replyTo: { id: number; userId: number; body: string } | null;
  createdAt: string;
  reactions?: Reaction[];
  /** Client-side only: an optimistic bubble waiting for the server's copy. */
  pending?: boolean;
  clientId?: string;
}

export interface Notification {
  id: number;
  userId: number;
  type: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface Activity {
  id: number;
  groupId: number;
  groupName: string;
  userId: number;
  userName: string;
  verb: string;
  subject: string;
  detail: string;
  createdAt: string;
}

export interface GroupData {
  members: Member[];
  columns: Column[];
  tasks: Task[];
}

export interface SearchResults {
  tasks: Task[];
  announcements: Announcement[];
  messages: { id: number; roomId: number; userId: number; senderName: string; body: string; createdAt: string }[];
  users: User[];
  groups: { id: number; name: string; description: string; icon: string; color: string }[];
}
