// VaultService（应用服务）：仓库用例——列出/打开/新建/移除，与 NoteService 平级。
// 仓库是应用级概念（跨 vault 生命周期），所以它不进 createDomain 的领域容器，
// 持有应用级聚合 VaultRegistry；IO 走 Backend 端口，完成后回填注册表。

import { backend, type VaultInfo, type BrowseDir } from "../backend";
import type { VaultRegistry } from "../domain/vault";

export class VaultService {
  constructor(readonly registry: VaultRegistry) {}

  /** 从后端拉取注册表全量（启动 / 回到管理页时刷新） */
  async refresh(): Promise<void> {
    const { vaults } = await backend.listVaults();
    this.registry.replace(vaults);
  }

  /** 打开仓库（登记 + 激活），返回最新引用；目录不存在时抛错 */
  async open(path: string): Promise<VaultInfo> {
    const ref = await backend.openVault(path);
    this.registry.upsert(ref);
    return ref;
  }

  /** 在 parent 下新建仓库文件夹并打开 */
  async create(parent: string, name: string): Promise<VaultInfo> {
    const ref = await backend.createVault(parent, name);
    this.registry.upsert(ref);
    return ref;
  }

  /** 仅从列表移除，不碰磁盘上的仓库文件夹 */
  async remove(path: string): Promise<void> {
    await backend.removeVault(path);
    this.registry.remove(path);
  }

  /** 弹系统对话框选文件夹（只选路径，是否打开由调用方决定） */
  pickFolder(): Promise<string | null> {
    return backend.pickFolder();
  }

  /** 目录浏览（web 模式自绘选目录弹窗的数据源）；桌面端无此通道，返回 null */
  browse(path: string): Promise<BrowseDir | null> {
    return backend.browse ? backend.browse(path) : Promise.resolve(null);
  }

  /** 新建/打开本地仓库卡片是否可用（web 模式退化为 VAULT_DIR 单仓库） */
  get canManage(): boolean {
    return backend.mode === "tauri";
  }
}
