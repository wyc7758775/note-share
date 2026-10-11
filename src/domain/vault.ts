// VaultRegistry（应用级聚合）：已知仓库列表的内存镜像 + React 订阅。
// 权威数据在桌面端 Rust 的 vaults.json（web 模式退化为 VAULT_DIR 单条），
// VaultService 经 Backend 端口读写后回填到这里，UI 用 useVaultsVersion 订阅刷新。
// 它不属于任何 vault 的领域容器（createDomain 的产物）：注册表的生命周期是
// 应用本身，切仓库时它存活、vault 域整体重建——所以它不复用 Domain 内的 EventBus。

import { useSyncExternalStore } from "react";

export interface VaultRef {
  id: string; // 稳定身份（vault 内 .noteshare/vault.json 清单持有，为同步预留）
  name: string;
  path: string; // 绝对路径；web 模式为 VAULT_DIR
  lastOpenedAt: number; // unix 秒，列表排序与"上次打开"判定
  exists: boolean; // 目录仍可访问（被移动/删除的仓库在 UI 上标灰）
}

export class VaultRegistry {
  private entries: VaultRef[] = [];
  private version = 0;
  private listeners = new Set<() => void>();

  /** 全量替换（service.refresh 从后端拉取后） */
  replace(list: VaultRef[]) {
    this.entries = [...list].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    this.bump();
  }

  /** 打开/新建后更新单条（按 path 去重） */
  upsert(ref: VaultRef) {
    const rest = this.entries.filter((v) => v.path !== ref.path);
    this.entries = [ref, ...rest].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    this.bump();
  }

  remove(path: string) {
    this.entries = this.entries.filter((v) => v.path !== path);
    this.bump();
  }

  list(): VaultRef[] {
    return this.entries;
  }

  byPath(path: string): VaultRef | undefined {
    return this.entries.find((v) => v.path === path);
  }

  /** 上次打开且目录仍在的仓库（列表已按 lastOpenedAt 倒序，取第一条可用的） */
  lastOpened(): VaultRef | null {
    return this.entries.find((v) => v.exists) ?? null;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private bump() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

/** 订阅注册表版本（列表任何变化触发重渲染） */
export function useVaultsVersion(registry: VaultRegistry): number {
  return useSyncExternalStore(registry.subscribe, registry.getVersion, registry.getVersion);
}
