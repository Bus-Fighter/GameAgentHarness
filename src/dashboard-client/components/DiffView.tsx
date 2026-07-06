interface DiffViewProps {
  diff: string;
  fontSize?: number;
  className?: string;
}

export function DiffView({ diff, fontSize = 14, className = "" }: DiffViewProps) {
  if (!diff) return null;
  return (
    <pre
      className={`whitespace-pre p-3 font-mono text-xs leading-relaxed ${className}`}
      style={{ fontSize: `${fontSize}px` }}
    >
      {diff.split("\n").map((line, i) => {
        let color = "";
        if (line.startsWith("+")) color = "text-green-400";
        else if (line.startsWith("-")) color = "text-red-400";
        else if (line.startsWith("@")) color = "text-[var(--muted)]";
        return (
          <div key={i} className={color}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
