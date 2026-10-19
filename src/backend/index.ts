import type { Backend } from "./types";
import { webBackend } from "./web";
import { tauriBackend } from "./tauri";

function detect(): Backend {
  // Tauri 2 会注入这个内部对象（注意是双下划线开头）
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return tauriBackend;
  }
  return webBackend;
}

export const backend: Backend = detect();
export type { Backend, TreeNode, NoteRaw, SearchHit, VaultInfo, VaultList, BrowseDir } from "./types";
