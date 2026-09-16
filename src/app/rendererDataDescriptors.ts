import type {
  RendererInsertType,
  SupportedRendererId,
} from "./rendererDataMessages";

export interface RendererDataDescriptor {
  readonly id: SupportedRendererId;
  readonly insertType: RendererInsertType;
  readonly language: "kanban-board" | "table";
  readonly fileSuffix: string;
  createDefaultData(): unknown;
  validateData(data: unknown): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidColumns(
  data: unknown,
  titleKey: "title" | "name",
): data is Record<string, unknown> & {
  columns: Array<Record<string, unknown>>;
} {
  if (!isRecord(data) || !Array.isArray(data.columns) || data.columns.length === 0) {
    return false;
  }

  return data.columns.every(
    (column) =>
      isRecord(column) &&
      typeof column.id === "string" &&
      column.id.length > 0 &&
      column[titleKey] !== undefined,
  );
}

const kanbanDescriptor: RendererDataDescriptor = {
  id: "kanban-board",
  insertType: "kanban-board",
  language: "kanban-board",
  fileSuffix: "kanban-board",
  createDefaultData: () => ({
    columns: [
      { id: "1", title: "Todo", items: [] },
      { id: "2", title: "Doing", items: [] },
      { id: "3", title: "Done", items: [] },
    ],
  }),
  validateData: (data) => hasValidColumns(data, "title"),
};

const tableDescriptor: RendererDataDescriptor = {
  id: "table-renderer",
  insertType: "table",
  language: "table",
  fileSuffix: "table-renderer",
  createDefaultData: () => ({
    columns: [
      { id: "col1", name: "Column 1", type: "text" },
      { id: "col2", name: "Column 2", type: "text" },
      { id: "col3", name: "Column 3", type: "text" },
    ],
    rows: [
      {
        id: "row1",
        cells: { col1: "Data 1", col2: "Data 2", col3: "Data 3" },
      },
      {
        id: "row2",
        cells: { col1: "Data 4", col2: "Data 5", col3: "Data 6" },
      },
    ],
  }),
  validateData: (data) =>
    hasValidColumns(data, "name") &&
    isRecord(data) &&
    Array.isArray(data.rows),
};

const descriptors: Record<SupportedRendererId, RendererDataDescriptor> = {
  "kanban-board": kanbanDescriptor,
  "table-renderer": tableDescriptor,
};

export function getRendererDataDescriptor(
  rendererId: unknown,
): RendererDataDescriptor {
  if (rendererId === "kanban-board" || rendererId === "table-renderer") {
    return descriptors[rendererId];
  }

  throw new Error("Unsupported renderer");
}

export function getRendererInsertDescriptor(
  rendererType: unknown,
): RendererDataDescriptor {
  if (rendererType === "kanban-board") return kanbanDescriptor;
  if (rendererType === "table") return tableDescriptor;
  throw new Error("Unsupported renderer");
}
