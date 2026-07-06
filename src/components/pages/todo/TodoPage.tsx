import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Todo {
  id: string;
  title: string;
  done: boolean;
  priority: number;
  due_at: number | null;
  created_at: number;
}

export function TodoPage({ compact }: { compact: boolean }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");

  const load = () => {
    void invoke<Todo[]>("todo_list").then(setTodos);
  };
  useEffect(load, []);

  const add = () => {
    const t = input.trim();
    if (!t) return;
    void invoke("todo_create", { title: t }).then(load);
    setInput("");
  };
  const toggle = (todo: Todo) => {
    void invoke("todo_update", { id: todo.id, done: !todo.done }).then(load);
  };
  const remove = (id: string) => {
    void invoke("todo_delete", { id }).then(load);
  };

  const pending = todos.filter((t) => !t.done).length;

  if (compact) {
    return (
      <span className="text-sm tabular-nums text-muted-foreground">
        {pending} 项待办
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="添加待办…（回车提交）"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" onClick={add} aria-label="添加">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {todos.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无待办
          </div>
        ) : (
          <ul className="space-y-1">
            {todos.map((t) => (
              <li
                key={t.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
              >
                <button
                  onClick={() => toggle(t)}
                  aria-label={t.done ? "标记未完成" : "标记完成"}
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    t.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input",
                  )}
                >
                  {t.done && <span className="text-[10px] leading-none">✓</span>}
                </button>
                <span
                  className={cn(
                    "flex-1 text-sm",
                    t.done && "text-muted-foreground line-through",
                  )}
                >
                  {t.title}
                </span>
                <button
                  onClick={() => remove(t.id)}
                  aria-label="删除"
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
