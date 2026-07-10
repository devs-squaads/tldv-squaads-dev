export interface ChatToolCatalogEntry {
  name: string;
  mutates: boolean;
}

export const CHAT_TOOL_CATALOG: readonly ChatToolCatalogEntry[] = [
  { name: "search_meetings", mutates: false },
  { name: "get_meeting_detail", mutates: false },
  { name: "get_system_status", mutates: false },
  { name: "enqueue_meeting", mutates: true },
  { name: "manage_meeting_share", mutates: true },
];
