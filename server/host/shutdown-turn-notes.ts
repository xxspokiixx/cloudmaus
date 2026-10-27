// Shutdown's "this turn was cut" lines. Moved out of server/index.ts unchanged.
import { failedTurnTool } from "../../shared/failed-turn.ts";
import type { Coordinator, HandoffView } from "../coordinator.ts";
import type { Store } from "../store.ts";

type Speaker = { botId: string; name: string; color: string; since?: number };

export interface ShutdownTurnNotesDeps {
  coordinator: Pick<Coordinator, "continuesAfterRestart" | "active">;
  store: Pick<Store, "bots" | "tasks" | "groups" | "groupTasks" | "appendMessage">;
  threadBusy(botId: string, threadId: string): boolean;
  groupThreadIsWorking(groupId: string, threadId: string): boolean;
  groupSpeakers: Map<string, Speaker>;
  ENDED: ReadonlySet<HandoffView["status"]>;
}

export function createShutdownTurnNotes(deps: ShutdownTurnNotesDeps) {
  const { coordinator, store, threadBusy, groupThreadIsWorking, groupSpeakers, ENDED } = deps;

  /** A root the runtime holds is the runtime's to account for at the next start: a line here, with Retry, would start the job a second time. */
  function noteTurnsCutByShutdown(): void {
    const cut = (threadId: string) => !coordinator.continuesAfterRestart(threadId) && !runtimeHoldsRoot(threadId);
    for (const bot of store.bots) {
      for (const task of store.tasks(bot.id)) {
        if (threadBusy(bot.id, task.threadId) && cut(task.threadId)) {
          store.appendMessage(task.threadId, { role: "bot", kind: "activity", tool: failedTurnTool("turn interrupted — OpenMausBot restarted") });
        }
      }
    }
    for (const group of store.groups) {
      for (const threadId of group.dm ? [group.threadId] : store.groupTasks(group.id).map((task) => task.threadId)) {
        if (!groupThreadIsWorking(group.id, threadId) || !cut(threadId)) continue;
        const speaker = groupSpeakers.get(threadId);
        store.appendMessage(threadId, { role: "bot", kind: "activity", ...(speaker ? { from: speaker } : {}), tool: failedTurnTool("turn interrupted — OpenMausBot restarted") });
      }
    }
  }

  function runtimeHoldsRoot(threadId: string): boolean {
    return coordinator.active().some((n) => !n.parentId && n.threadId === threadId && !ENDED.has(n.status));
  }

  return { noteTurnsCutByShutdown };
}
