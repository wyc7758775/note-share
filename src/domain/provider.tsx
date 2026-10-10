// 领域容器：EventBus / NoteDirectory / NoteService / ReadingPositions / SessionBook 全局单例 + React 绑定。
// 组件通过 useDomain() 取服务；名录变化通过 useSyncExternalStore 订阅。
import { createContext, useContext, useSyncExternalStore } from "react";
import { EventBus } from "./events";
import { NoteDirectory } from "./directory";
import { NoteService } from "../application/note-service";
import { ReadingPositions, SessionBook } from "./session";
import { Workspace } from "./workspace";

export interface Domain {
  bus: EventBus;
  directory: NoteDirectory;
  notes: NoteService;
  positions: ReadingPositions;
  sessions: SessionBook;
  workspace: Workspace;
}

const Ctx = createContext<Domain>(null!);

// 组合根单例：tiptap 节点视图渲染在独立 React root 里，拿不到主树 context，
// useDomain 在 context 缺失时回退到该单例（领域容器本就是应用级唯一实例）
let singleton: Domain | null = null;

export function createDomain(): Domain {
  const bus = new EventBus();
  const positions = new ReadingPositions(bus);
  singleton = {
    bus,
    directory: new NoteDirectory(bus),
    notes: new NoteService(bus),
    positions,
    sessions: new SessionBook(bus, positions),
    workspace: new Workspace(bus),
  };
  return singleton;
}

export function DomainProvider({ domain, children }: { domain: Domain; children: React.ReactNode }) {
  return <Ctx.Provider value={domain}>{children}</Ctx.Provider>;
}

export function useDomain(): Domain {
  const d = useContext(Ctx);
  return d ?? singleton!;
}

/** 订阅名录版本（名录任何变化触发重渲染） */
export function useDirectoryVersion(): number {
  const { directory } = useDomain();
  return useSyncExternalStore(directory.subscribe, directory.getVersion, directory.getVersion);
}

/** 订阅工作台版本（分栏布局任何变化触发重渲染） */
export function useWorkspaceVersion(): number {
  const { workspace } = useDomain();
  return useSyncExternalStore(workspace.subscribe, workspace.getVersion, workspace.getVersion);
}
