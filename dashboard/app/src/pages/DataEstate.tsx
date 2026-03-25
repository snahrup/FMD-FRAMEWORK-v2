import { Globe } from "lucide-react";

/**
 * DataEstate — Packet E crown jewel page.
 * Premium animated exec-demo visualization of the entire data pipeline.
 * This is a placeholder that will be fully built during Packet E implementation.
 */
export default function DataEstate() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
      <div className="text-center space-y-4 max-w-md">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "var(--bp-accent, #b8612b)", color: "#fff" }}
        >
          <Globe size={32} />
        </div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--bp-ink)" }}>
          Data Estate
        </h1>
        <p className="text-sm" style={{ color: "var(--bp-ink-muted)" }}>
          A premium, animated visualization of the entire data pipeline —
          sources through governance. Coming in Packet E.
        </p>
      </div>
    </div>
  );
}
