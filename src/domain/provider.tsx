// 领域容器：EventBus / NoteDirectory / NoteService / ReadingPositions 全局单例 + React 绑定。
// 组件通过 useDomain() 取服务；名录变化通过 useSyncExternalStore 订阅。
import { createContext, useContext, useSyncExternalStore } from "react";
import { EventBus } from "./events";
import { NoteDirectory } from "./directory";
import { NoteService } from "../application/note-service";
import { ReadingPositions } from "./session";

export interface Domain {
  bus: EventBus;
  directory: NoteDirectory;
  notes: NoteService;
  positions: ReadingPositions;
}

const Ctx = createContext<Domain>(null!);

export function createDomain(): Domain {
  const bus = new EventBus();
  return {
    bus,
    directory: new NoteDirectory(bus),
    notes: new NoteService(bus),
    positions: new ReadingPositions(bus),
  };
}

export function DomainProvider({ domain, children }: { domain: Domain; children: React.ReactNode }) {
  return <Ctx.Provider value={domain}>{children}</Ctx.Provider>;
}

export function useDomain(): Domain {
  const d = useContext(Ctx);
  if (!d) throw new Error("useDomain must be used inside DomainProvider");
  return d;
}

/** 订阅名录版本（名录任何变化触发重渲染） */
export function useDirectoryVersion(): number {
  const { directory } = useDomain();
  return useSyncExternalStore(directory.subscribe, directory.getVersion, directory.getVersion);
}
