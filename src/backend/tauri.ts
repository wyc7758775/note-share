import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
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

// 与 src-tauri/src/lib.rs 中的 command 一一对应
export const tauriBackend: Backend = {
  mode: "tauri",
  listVaults: () => invoke<VaultList>("list_vaults"),
  openVault: (path) => invoke<VaultInfo>("open_vault", { path }),
  createVault: (parent, name) => invoke<VaultInfo>("create_vault", { parent, name }),
  removeVault: (path) => invoke<void>("remove_vault", { path }),
  pickFolder: async () => {
    const dir = await open({ directory: true, title: "选择仓库文件夹" });
    return typeof dir === "string" ? dir : null;
  },
  tree: () => invoke<TreeNode[]>("tree"),
  readNote: (path) => invoke<NoteRaw>("read_note", { path }),
  writeNote: (path, raw) => invoke<void>("write_note", { path, raw }),
  createNote: (folder, title) => invoke<string>("create_note", { folder, title }),
  createFolder: (parent, name) => invoke<string>("create_folder", { parent, name }),
  renamePath: (from, newName) => invoke<string>("rename_path", { from, newName }),
  movePath: (from, toFolder) => invoke<string>("move_path", { from, toFolder }),
  deletePath: (path) => invoke<void>("delete_path", { path }),
  search: (q) => invoke<SearchHit[]>("search", { q }),
  readScene: (path) => invoke<string>("read_scene", { path }),
  saveScene: (name, sceneJson, pngBase64, _folder?) =>
    invoke<SavedScene>("save_scene", { name, sceneJson, pngBase64 }),
  createCanvas: (folder, name) =>
    invoke<string>("create_canvas", { folder: folder ?? null, name: name ?? null }),
  saveAsset: (name, base64) => invoke<{ path: string }>("save_asset", { name, base64 }),
  readAssetBase64: (path) => invoke<AssetData>("read_asset", { path }),
  importFile: (folder, name, base64) =>
    invoke<string>("import_file", { folder: folder || null, name, base64 }),
  saveTextFile: async (defaultName, content) => {
    const target = await save({ defaultPath: defaultName });
    if (typeof target !== "string") return null;
    await invoke("save_text_file", { target, content });
    return target;
  },
  saveBinaryFile: async (defaultName, base64) => {
    const target = await save({ defaultPath: defaultName });
    if (typeof target !== "string") return null;
    await invoke("save_binary_file", { target, base64 });
    return target;
  },
};
