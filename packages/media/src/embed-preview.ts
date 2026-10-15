import { vscodeLog } from "./webview-state";

/** Embed details the host resolves for a wiki-link preview. */
interface EmbedPreview {
  fileName?: string;
  path?: string;
  dataUrl?: string;
  mimeType?: string;
  text?: string;
  note?: string;
}

function readEmbed(embed: Record<string, unknown>): EmbedPreview {
  const text = (key: keyof EmbedPreview) => (typeof embed[key] === "string" ? (embed[key] as string) : undefined);
  return {
    fileName: text("fileName"),
    path: text("path"),
    dataUrl: text("dataUrl"),
    mimeType: text("mimeType"),
    text: text("text"),
    note: text("note"),
  };
}

/** Show (or replace) the floating embed preview overlay. */
export function showEmbedPreview(rawEmbed: Record<string, unknown>): void {
  try {
    const embed = readEmbed(rawEmbed);
    // Create or reuse preview overlay
    let overlay = document.getElementById(
      "vscode-embed-preview-overlay"
    ) as HTMLDivElement | null;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "vscode-embed-preview-overlay";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = "";

    // Create header with title and icon buttons
    const header = document.createElement("div");
    header.className = "embed-header";

    const title = document.createElement("div");
    title.className = "embed-title";
    title.textContent =
      embed.fileName ||
      (embed.path ? embed.path.split("/").slice(-1)[0] : "Embed Preview");

    const actions = document.createElement("div");
    actions.className = "embed-actions";

    // Open file icon button (if path available)
    if (embed.path) {
      const openBtn = document.createElement("button");
      openBtn.className = "icon-btn codicon codicon-link-external";
      openBtn.setAttribute("data-tooltip", "Open File");
      openBtn.setAttribute("aria-label", "Open File");
      openBtn.addEventListener("click", () => {
        try {
          vscode?.postMessage({ command: "openFile", path: embed.path });
        } catch (err) {
          vscodeLog(`❌ open button postMessage failed: ${err}`);
        }
      });
      actions.appendChild(openBtn);
    }

    // Download icon button (if dataUrl available)
    if (embed.dataUrl) {
      const downloadBtn = document.createElement("a");
      downloadBtn.className = "icon-btn";
      downloadBtn.setAttribute("data-tooltip", "Download");
      downloadBtn.setAttribute("aria-label", "Download");
      downloadBtn.textContent = "⬇";
      downloadBtn.href = embed.dataUrl;
      downloadBtn.download = embed.fileName || "download";
      downloadBtn.style.textDecoration = "none";
      actions.appendChild(downloadBtn);
    }

    // Close icon button
    const closeBtn = document.createElement("button");
    closeBtn.className = "icon-btn codicon codicon-close";
    closeBtn.setAttribute("data-tooltip", "Close");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      overlay && overlay.remove();
    });
    actions.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(actions);
    overlay.appendChild(header);

    // Create scrollable content area
    const content = document.createElement("div");
    content.className = "embed-content";

    // Add content based on type
    if (embed.dataUrl && (embed.mimeType || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.src = embed.dataUrl;
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      content.appendChild(img);
    } else if (embed.text) {
      const pre = document.createElement("pre");
      pre.textContent = embed.text.substring(0, 20000); // limit
      content.appendChild(pre);
    } else if (embed.dataUrl) {
      const link = document.createElement("a");
      link.href = embed.dataUrl;
      link.textContent = embed.fileName || "Download";
      link.target = "_blank";
      content.appendChild(link);
    } else if (embed.path) {
      const info = document.createElement("div");
      info.textContent = `Path: ${embed.path}`;
      content.appendChild(info);
    } else {
      const info = document.createElement("div");
      info.textContent = "No preview available for this embed";
      content.appendChild(info);
    }

    // If the extension chose not to embed the file (too large), show the note
    if (embed.note) {
      const note = document.createElement("div");
      note.style.marginTop = "8px";
      note.style.fontSize = "12px";
      note.style.opacity = "0.9";
      note.textContent = embed.note;
      content.appendChild(note);
    }

    overlay.appendChild(content);
  } catch (err) {
    vscodeLog(`❌ openEmbedPreview handler failed: ${err}`);
  }
}
