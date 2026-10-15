import type {
  AssetData,
  Backend,
  NoteRaw,
  SavedScene,
  SearchHit,
  TreeNode,
  VaultInfo,
  VaultList,
} from "./types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/${cmd}`, {
    method: args ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: args ? JSON.stringify(args) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(`后端错误: ${msg}`);
  }
  return res.json() as Promise<T>;
}

export const webBackend: Backend = {
  mode: "web",
  listVaults: () => call<VaultList>("vault-list"),
  openVault: (path) => call<VaultInfo>("vault-open", { path }),
  createVault: (parent, name) => call<VaultInfo>("vault-create", { parent, name }),
  removeVault: (path) => call<void>("vault-remove", { path }),
  pickFolder: async () => null,
  tree: () => call<TreeNode[]>("tree"),
  readNote: (path) => call<NoteRaw>("note", { path }),
  writeNote: (path, raw) => call<void>("note-save", { path, raw }),
  createNote: (folder, title) => call<string>("note-create", { folder, title }),
  createFolder: (parent, name) => call<string>("folder-create", { parent, name }),
  renamePath: (from, newName) => call<string>("rename", { from, newName }),
  movePath: (from, toFolder) => call<string>("move", { from, toFolder }),
  deletePath: (path) => call<void>("delete", { path }),
  revealPath: (path) => call<void>("reveal", { path }),
  search: (q) => call<SearchHit[]>("search", { q }),
  readScene: (path) => call<string>("scene", { path }),
  saveScene: (name, sceneJson, pngBase64, _folder?) =>
    call<SavedScene>("scene-save", { name, sceneJson, pngBase64 }),
  createCanvas: (folder, name) => call<string>("canvas-create", { folder, name }),
  saveAsset: (name, base64) => call<{ path: string }>("asset-save", { name, base64 }),
  readAssetBase64: (path) => call<AssetData>("asset", { path }),
  importFile: (folder, name, base64) => call<string>("import-file", { folder, name, base64 }),
  saveTextFile: async () => null,
  saveBinaryFile: async () => null,
};
