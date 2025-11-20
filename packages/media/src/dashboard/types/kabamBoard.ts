export interface KanbanItem {
  id: string;
  content: string;
  [key: string]: any;
}

export interface KanbanColumn {
  id: string;
  title: string;
  items: KanbanItem[];
}

export interface KanbanData {
  columns: KanbanColumn[];
}

export const DEFAULT_KANBAN_DATA: KanbanData = {
  columns: [
    { id: "1", title: "Todo", items: [] },
    { id: "2", title: "Doing", items: [] },
    { id: "3", title: "Done", items: [] }
  ]
};