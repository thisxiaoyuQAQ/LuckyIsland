import { cn } from "@/lib/utils";
import { ActionCard } from "./ActionCard";
import type { Message } from "@/lib/ai";

/**
 * 容错显示：若 content 是动作 JSON（后端 parse 失败回退原文的情况），
 * 尝试取 args.text；并把字面 `\n`（两字符）转成换行。
 */
function displayContent(content: string): string {
  const t = content.trim();
  if (t.startsWith("{")) {
    try {
      const v = JSON.parse(t);
      if (v?.args?.text && typeof v.args.text === "string") return v.args.text;
    } catch {
      // 解析失败回退原文
    }
  }
  return content.replace(/\\n/g, "\n");
}

/** 对话历史：用户消息右对齐，助手左对齐，助手可附动作卡片 */
export function Conversation({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        告诉我要做什么…（如「看股票」「加待办 买牛奶」「搜 rust tauri」）
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {messages.map((m, i) => (
        <div
          key={i}
          className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
        >
          <div
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm",
              m.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            <div className="whitespace-pre-wrap break-words">{displayContent(m.content)}</div>
            {/* reply 动作的执行结果就是正文本身，卡片会重复展示同一段文字，故只在真正"做了件事"
                （如 add_todo）的动作上显示 */}
            {m.action && m.action.action !== "reply" && <ActionCard action={m.action} />}
          </div>
        </div>
      ))}
    </div>
  );
}
