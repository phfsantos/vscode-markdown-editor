export interface PendingDocumentWrite {
  readonly content: string;
}

export interface DocumentWriteOriginTracker {
  expect(content: string): PendingDocumentWrite;
  consume(content: string): boolean;
  cancel(write: PendingDocumentWrite): void;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function createDocumentWriteOriginTracker(): DocumentWriteOriginTracker {
  const pendingWrites: PendingDocumentWrite[] = [];

  return {
    expect(content) {
      const write = { content };
      pendingWrites.push(write);
      return write;
    },

    consume(content) {
      const comparableContent = normalizeLineEndings(content);
      const index = pendingWrites.findIndex(
        (write) => normalizeLineEndings(write.content) === comparableContent,
      );
      if (index < 0) {
        return false;
      }
      pendingWrites.splice(index, 1);
      return true;
    },

    cancel(write) {
      const index = pendingWrites.indexOf(write);
      if (index >= 0) {
        pendingWrites.splice(index, 1);
      }
    },
  };
}
