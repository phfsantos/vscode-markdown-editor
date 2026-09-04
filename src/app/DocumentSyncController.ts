export interface DocumentRevision {
  content: string;
  generation: number;
  revision: number;
}

export interface DocumentSyncDependencies {
  applyContent(content: string): Promise<void>;
  saveDocument(): Promise<boolean | void>;
}

export interface DocumentSyncController {
  acceptEdit(edit: DocumentRevision): boolean;
  acceptExternalContent(content: string): number;
  save(request: DocumentRevision): Promise<boolean>;
  advanceGeneration(): number;
  getGeneration(): number;
  dispose(): void;
}

interface ApplyOperation {
  kind: "apply";
  edit: DocumentRevision;
  source: "local" | "external";
  attempts: number;
}

interface SaveOperation {
  kind: "save";
  generation: number;
  revision: number;
  resolve(result: boolean): void;
}

type SyncOperation = ApplyOperation | SaveOperation;

export function isDocumentRevision(value: unknown): value is DocumentRevision {
  if (!value || typeof value !== "object") {
    return false;
  }
  const revision = value as Partial<DocumentRevision>;
  return (
    typeof revision.content === "string" &&
    Number.isSafeInteger(revision.generation) &&
    revision.generation! >= 0 &&
    Number.isSafeInteger(revision.revision) &&
    revision.revision! >= 0
  );
}

export function createDocumentSyncController(
  dependencies: DocumentSyncDependencies,
  initialGeneration = 0,
): DocumentSyncController {
  let generation = initialGeneration;
  let highestAcceptedRevision = 0;
  let highestAppliedRevision = 0;
  let processing = false;
  let disposed = false;
  let activeApply: ApplyOperation | undefined;
  let failedApply: ApplyOperation | undefined;
  const queue: SyncOperation[] = [];

  const resolveQueuedSaves = (result: boolean): void => {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const operation = queue[index];
      if (operation.kind === "save") {
        queue.splice(index, 1);
        operation.resolve(result);
      }
    }
  };

  const pump = async (): Promise<void> => {
    if (processing || failedApply) {
      return;
    }
    processing = true;

    while (queue.length > 0 && !failedApply && !disposed) {
      const operation = queue.shift()!;
      if (operation.kind === "save") {
        if (
          operation.generation !== generation ||
          highestAppliedRevision < operation.revision
        ) {
          operation.resolve(false);
          continue;
        }
        try {
          const saved = await dependencies.saveDocument();
          operation.resolve(
            !disposed &&
              saved !== false &&
              operation.generation === generation,
          );
        } catch {
          operation.resolve(false);
        }
        continue;
      }

      activeApply = operation;
      try {
        await dependencies.applyContent(operation.edit.content);
        if (!disposed && operation.edit.generation === generation) {
          highestAppliedRevision = Math.max(
            highestAppliedRevision,
            operation.edit.revision,
          );
        }
      } catch {
        if (disposed || operation.edit.generation !== generation) {
          // A newer external generation superseded this failed write.
        } else {
          const hasNewerQueuedEdit = queue.some(
            (queued) =>
              queued.kind === "apply" &&
              queued.edit.generation === generation &&
              queued.edit.revision > operation.edit.revision,
          );
          const hasQueuedSave = queue.some(
            (queued) =>
              queued.kind === "save" && queued.generation === generation,
          );

          if (hasNewerQueuedEdit) {
            // The newer full-document snapshot safely supersedes this one.
          } else if (hasQueuedSave && operation.attempts === 0) {
            queue.unshift({ ...operation, attempts: 1 });
          } else {
            failedApply = operation;
            resolveQueuedSaves(false);
          }
        }
      } finally {
        activeApply = undefined;
      }
    }

    processing = false;
  };

  const startPump = (): void => {
    if (disposed) {
      return;
    }
    void pump();
  };

  const enqueueEdit = (
    edit: DocumentRevision,
    source: ApplyOperation["source"],
  ): void => {
    const lastOperation = queue[queue.length - 1];
    if (
      source === "local" &&
      lastOperation?.kind === "apply" &&
      lastOperation.source === "local" &&
      lastOperation.edit.generation === edit.generation
    ) {
      lastOperation.edit = edit;
      lastOperation.attempts = 0;
    } else {
      queue.push({ kind: "apply", edit, source, attempts: 0 });
    }
    startPump();
  };

  const acceptEdit = (edit: DocumentRevision): boolean => {
    if (
      disposed ||
      !isDocumentRevision(edit) ||
      edit.generation !== generation ||
      edit.revision <= highestAcceptedRevision
    ) {
      return false;
    }

    highestAcceptedRevision = edit.revision;
    if (
      failedApply &&
      failedApply.edit.generation === generation &&
      edit.revision > failedApply.edit.revision
    ) {
      failedApply = undefined;
    }
    enqueueEdit(edit, "local");
    return true;
  };

  const clearQueuedGeneration = (): void => {
    for (const operation of queue.splice(0)) {
      if (operation.kind === "save") {
        operation.resolve(false);
      }
    }
  };

  const advanceGeneration = (): number => {
    if (disposed) {
      return generation;
    }
    generation += 1;
    highestAcceptedRevision = 0;
    highestAppliedRevision = 0;
    failedApply = undefined;
    clearQueuedGeneration();
    return generation;
  };

  return {
    acceptEdit,

    acceptExternalContent(content) {
      if (disposed) {
        return generation;
      }
      const hadStaleInFlight = Boolean(activeApply);
      const nextGeneration = advanceGeneration();
      if (hadStaleInFlight) {
        enqueueEdit(
          { content, generation: nextGeneration, revision: 0 },
          "external",
        );
      }
      return nextGeneration;
    },

    async save(request) {
      if (
        disposed ||
        !isDocumentRevision(request) ||
        request.generation !== generation
      ) {
        return false;
      }

      if (request.revision > highestAcceptedRevision && !acceptEdit(request)) {
        return false;
      }

      if (failedApply?.edit.generation === generation) {
        const retry = failedApply;
        failedApply = undefined;
        queue.unshift({ ...retry, attempts: 1 });
      }

      const targetRevision = Math.max(
        request.revision,
        highestAcceptedRevision,
      );
      return new Promise<boolean>((resolve) => {
        queue.push({
          kind: "save",
          generation,
          revision: targetRevision,
          resolve,
        });
        startPump();
      });
    },

    advanceGeneration,

    getGeneration() {
      return generation;
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      failedApply = undefined;
      clearQueuedGeneration();
    },
  };
}
