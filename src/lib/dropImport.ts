// OS 文件拖放导入：File → base64 → NoteService.importFile（vault 指定文件夹）。
// 全窗口覆盖层（DropImport 组件）与文件树文件夹行定向 drop 共用这套逻辑。
import type { NoteService } from "../application/note-service";

/** 读单个 File 为纯 base64（不带 data: 前缀） */
export function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    // split 取逗号后段；dataURL 的 base64 部分不含逗号，安全
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(f);
  });
}

export interface ImportResult {
  notes: string[]; // 导入的 .md vault 路径
  assets: string[]; // 其余文件
  failed: string[]; // 失败的文件名
}

/** 把一组 OS 文件导入 vault 的 folder（"" = 根）；串行写避免同目录撞名竞争 */
export async function importDroppedFiles(
  files: Iterable<File>,
  folder: string,
  svc: NoteService
): Promise<ImportResult> {
  const out: ImportResult = { notes: [], assets: [], failed: [] };
  for (const f of files) {
    try {
      const base64 = await fileToBase64(f);
      const path = await svc.importFile(folder, f.name, base64);
      if (!path) {
        out.failed.push(f.name);
        continue;
      }
      (/\.md$/i.test(path) ? out.notes : out.assets).push(path);
    } catch (e) {
      console.error("导入文件失败", f.name, e);
      out.failed.push(f.name);
    }
  }
  return out;
}
