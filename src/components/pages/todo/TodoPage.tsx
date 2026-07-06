export function TodoPage({ compact }: { compact: boolean }) {
  if (compact) {
    return <span className="text-sm text-muted-foreground">待办</span>;
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      待办页 · M2 块2 接入 CRUD + SQLite 持久化
    </div>
  );
}
