export interface WebviewContentRevision {
  command: "edit";
  content: string;
  generation: number;
  revision: number;
}

export interface WebviewSaveRequest {
  command: "save";
  content: string;
  generation: number;
  revision: number;
}

export interface WebviewContentSync {
  acceptInput(content: string): WebviewContentRevision;
  acceptProgrammaticUpdate(content: string): WebviewContentRevision;
  createSaveRequest(): WebviewSaveRequest;
  acceptExternalUpdate(content: string, generation: number): boolean;
  getContent(): string;
  getGeneration(): number;
}

let activeContentSync: WebviewContentSync | undefined;

interface VditorInputSource {
  vditor?: {
    ir?: {
      element?: EventTarget;
    };
  };
}

export function dispatchVditorInput(vditor: VditorInputSource): boolean {
  const editorElement = vditor.vditor?.ir?.element;
  if (!editorElement) {
    return false;
  }
  editorElement.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

export function synchronizeVditorInput(
  contentSync: WebviewContentSync,
  content: string,
): WebviewContentRevision {
  return contentSync.acceptInput(content);
}

export function createWebviewContentSync(
  postMessage: (message: WebviewContentRevision | WebviewSaveRequest) => void,
  initialContent = "",
  initialGeneration = 0,
): WebviewContentSync {
  let content = initialContent;
  let generation = initialGeneration;
  let revision = 0;

  const acceptLocalContent = (nextContent: string): WebviewContentRevision => {
    content = nextContent;
    revision += 1;
    const message: WebviewContentRevision = {
      command: "edit",
      content,
      generation,
      revision,
    };
    postMessage(message);
    return message;
  };

  return {
    acceptInput: acceptLocalContent,
    acceptProgrammaticUpdate: acceptLocalContent,

    createSaveRequest() {
      const message: WebviewSaveRequest = {
        command: "save",
        content,
        generation,
        revision,
      };
      postMessage(message);
      return message;
    },

    acceptExternalUpdate(nextContent, nextGeneration) {
      if (nextGeneration <= generation) {
        return false;
      }
      content = nextContent;
      generation = nextGeneration;
      revision = 0;
      return true;
    },

    getContent() {
      return content;
    },

    getGeneration() {
      return generation;
    },
  };
}

export function initializeWebviewContentSync(
  postMessage: (message: WebviewContentRevision | WebviewSaveRequest) => void,
  initialContent = "",
  initialGeneration = 0,
): WebviewContentSync {
  activeContentSync = createWebviewContentSync(
    postMessage,
    initialContent,
    initialGeneration,
  );
  return activeContentSync;
}

export function getWebviewContentSync(): WebviewContentSync {
  if (!activeContentSync) {
    throw new Error("Webview content synchronization is not initialized");
  }
  return activeContentSync;
}
