import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MemoryHistogramDay } from "../../api";
import { dayKeyInTimeZone } from "../../lib/entityEvidence";

const MONO_FONT = "'JetBrains Mono','SF Mono',ui-monospace,monospace";
const PAD = 14;
const DAYS_SHOWN = 90;

export interface TimeWindow {
  start: string;
  end: string;
}

export interface LifeLine {
  name: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  mentionCount: number;
  mentionDays: string[];
}

type EvidenceStatus = "loading" | "ready" | "unavailable";

interface TimeStripProps {
  days: MemoryHistogramDay[];
  timeZone: string | null;
  evidenceStatus: EvidenceStatus;
  onRetry: () => void;
  window: TimeWindow | null;
  onWindowChange: (window: TimeWindow | null) => void;
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
  lifeLine: LifeLine | null;
}

function parseDayKey(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function shiftDayKey(day: string, amount: number): string | null {
  const date = parseDayKey(day);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function buildTimeAxis(days: MemoryHistogramDay[], timeZone: string, now = new Date()): { keys: string[]; counts: number[] } | null {
  const today = dayKeyInTimeZone(now, timeZone);
  if (!today) return null;
  const byDay = new Map(days.map((day) => [day.day, day.count]));
  const keys: string[] = [];
  const counts: number[] = [];
  for (let offset = DAYS_SHOWN - 1; offset >= 0; offset -= 1) {
    const key = shiftDayKey(today, -offset);
    if (!key) return null;
    keys.push(key);
    counts.push(byDay.get(key) ?? 0);
  }
  return { keys, counts };
}

function labelDate(day: string, options: Intl.DateTimeFormatOptions): string {
  const date = parseDayKey(day);
  return date ? new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(date) : "date unavailable";
}

function monthYear(timestamp: string, timeZone: string): string {
  const key = dayKeyInTimeZone(timestamp, timeZone);
  return key ? labelDate(key, { month: "short", year: "numeric" }) : "unknown";
}

function daysBetween(start: string, end: string): number {
  const a = parseDayKey(start)?.getTime();
  const b = parseDayKey(end)?.getTime();
  if (a === undefined || b === undefined) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export function TimeStrip({
  days,
  timeZone,
  evidenceStatus,
  onRetry,
  window: timeWindow,
  onWindowChange,
  selectedDay,
  onSelectDay,
  lifeLine,
}: TimeStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null);
  const brushingRef = useRef<{ origin: number; moved: boolean } | null>(null);
  const axis = useMemo(() => timeZone ? buildTimeAxis(days, timeZone) : null, [days, timeZone]);
  const today = axis?.keys.at(-1) ?? "";
  const [dayInput, setDayInput] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  useEffect(() => {
    if (!dayInput && today) setDayInput(today);
  }, [dayInput, today]);

  useEffect(() => {
    setRangeStart(timeWindow?.start ?? "");
    setRangeEnd(timeWindow?.end ?? "");
  }, [timeWindow]);

  const syncCanvasSize = useCallback((canvas: HTMLCanvasElement) => {
    const dpr = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return null;
    const bufferWidth = Math.round(width * dpr);
    const bufferHeight = Math.round(height * dpr);
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    return { width, height, dpr };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !axis) return;
    const dimensions = syncCanvasSize(canvas);
    const context = canvas.getContext("2d");
    if (!dimensions || !context) return;
    const { width, height, dpr } = dimensions;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const barWidth = (width - PAD * 2) / DAYS_SHOWN;
    const max = Math.max(1, ...axis.counts);
    const preview = brush
      ? { low: Math.min(brush.a, brush.b), high: Math.max(brush.a, brush.b) }
      : timeWindow
        ? { low: axis.keys.indexOf(timeWindow.start), high: axis.keys.indexOf(timeWindow.end) }
        : null;

    context.font = `8.5px ${MONO_FONT}`;
    context.textAlign = "left";
    axis.keys.forEach((key, index) => {
      if (key.endsWith("-01")) {
        context.fillStyle = "rgba(120,113,108,0.95)";
        context.fillText(labelDate(key, { month: "short" }), PAD + index * barWidth, height - 3);
      }
    });

    axis.counts.forEach((count, index) => {
      const barHeight = Math.max(1, (count / max) * (height - 24));
      let alpha = lifeLine ? 0.14 : 0.42;
      if (!lifeLine && preview?.low !== undefined && preview.low >= 0) alpha = index >= preview.low && index <= preview.high ? 0.72 : 0.2;
      if (index === hoverIdx) alpha = Math.min(0.9, alpha + 0.25);
      if (selectedDay === axis.keys[index]) alpha = 0.95;
      context.fillStyle = `rgba(168,162,158,${alpha.toFixed(2)})`;
      context.fillRect(PAD + index * barWidth + 0.5, height - 14 - barHeight, Math.max(1, barWidth - 1.5), barHeight);
    });

    if (lifeLine) {
      const lineY = Math.round(height * 0.42);
      const firstKey = lifeLine.firstSeenAt && timeZone ? dayKeyInTimeZone(lifeLine.firstSeenAt, timeZone) : null;
      const lastKey = lifeLine.lastSeenAt && timeZone ? dayKeyInTimeZone(lifeLine.lastSeenAt, timeZone) : null;
      const firstIndex = firstKey ? axis.keys.indexOf(firstKey) : -1;
      const lastIndex = lastKey ? axis.keys.indexOf(lastKey) : -1;
      const beganEarlier = firstKey !== null && firstIndex < 0 && firstKey < axis.keys[0];
      const low = firstIndex >= 0 ? firstIndex : beganEarlier ? 0 : -1;
      const high = lastIndex >= 0 ? lastIndex : DAYS_SHOWN - 1;
      if (low >= 0) {
        const x0 = PAD + low * barWidth + barWidth / 2;
        const x1 = PAD + high * barWidth + barWidth / 2;
        context.strokeStyle = "rgba(212,167,106,0.55)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x0, lineY);
        context.lineTo(x1, lineY);
        context.stroke();
        if (!beganEarlier) {
          context.fillStyle = "rgba(212,167,106,0.95)";
          context.beginPath();
          context.arc(x0, lineY, 2.6, 0, Math.PI * 2);
          context.fill();
        }
        context.strokeStyle = "rgba(212,167,106,0.9)";
        lifeLine.mentionDays.forEach((day) => {
          const index = axis.keys.indexOf(day);
          if (index < 0) return;
          const x = PAD + index * barWidth + barWidth / 2;
          context.beginPath();
          context.moveTo(x, lineY - 4);
          context.lineTo(x, lineY + 4);
          context.stroke();
        });
      }
    }

    if (hoverIdx !== null && !lifeLine && !brushingRef.current) {
      context.textAlign = "center";
      context.fillStyle = "rgba(214,211,209,0.9)";
      const label = `${labelDate(axis.keys[hoverIdx], { month: "short", day: "numeric" })} · ${axis.counts[hoverIdx]} memories`;
      context.fillText(label, Math.min(width - 70, Math.max(70, PAD + hoverIdx * barWidth)), 10);
    }
  }, [axis, brush, hoverIdx, lifeLine, selectedDay, syncCanvasSize, timeWindow, timeZone]);

  useEffect(draw, [draw]);
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const dayIndexAt = useCallback((event: { clientX: number }): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || !axis) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < PAD || x > rect.width - PAD) return null;
    const barWidth = (rect.width - PAD * 2) / DAYS_SHOWN;
    return Math.max(0, Math.min(DAYS_SHOWN - 1, Math.floor((x - PAD) / barWidth)));
  }, [axis]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (lifeLine || !axis) return;
    const index = dayIndexAt(event);
    if (index === null) {
      onWindowChange(null);
      return;
    }
    brushingRef.current = { origin: index, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [axis, dayIndexAt, lifeLine, onWindowChange]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const index = dayIndexAt(event);
    const brushing = brushingRef.current;
    if (!brushing) {
      setHoverIdx(index);
      return;
    }
    if (index === null) return;
    if (index !== brushing.origin) brushing.moved = true;
    if (brushing.moved) setBrush({ a: brushing.origin, b: index });
  }, [dayIndexAt]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const brushing = brushingRef.current;
    brushingRef.current = null;
    if (!brushing || !axis) return;
    const index = dayIndexAt(event) ?? brushing.origin;
    setBrush(null);
    if (brushing.moved) {
      const low = Math.min(brushing.origin, index);
      const high = Math.max(brushing.origin, index);
      onWindowChange({ start: axis.keys[low], end: axis.keys[high] });
    } else {
      onSelectDay(axis.keys[index]);
    }
  }, [axis, dayIndexAt, onSelectDay, onWindowChange]);

  const cancelPointer = useCallback(() => {
    brushingRef.current = null;
    setBrush(null);
  }, []);

  let caption = "90 days of memory";
  if (evidenceStatus === "loading") caption = "Loading activity calendar…";
  if (evidenceStatus === "unavailable" || !axis || !timeZone) caption = "Activity calendar unavailable";
  if (evidenceStatus === "ready" && lifeLine && timeZone) {
    const lastKey = lifeLine.lastSeenAt ? dayKeyInTimeZone(lifeLine.lastSeenAt, timeZone) : null;
    const quietDays = lastKey && today ? daysBetween(lastKey, today) : null;
    caption = [
      `${lifeLine.name} — first seen ${lifeLine.firstSeenAt ? monthYear(lifeLine.firstSeenAt, timeZone) : "unknown"}`,
      `${lifeLine.mentionCount} mentions`,
      quietDays === null ? "last seen unknown" : `last seen ${quietDays}d ago`,
    ].join(" · ");
  } else if (evidenceStatus === "ready" && timeWindow) {
    caption = `${timeWindow.start} – ${timeWindow.end}`;
  }

  const applyRange = () => {
    if (!axis || !rangeStart || !rangeEnd) return;
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    if (start < axis.keys[0] || end > axis.keys.at(-1)!) return;
    onWindowChange({ start, end });
  };

  const ready = evidenceStatus === "ready" && axis !== null && timeZone !== null;

  return (
    <section className="flex-shrink-0 border-t border-stone-800/40 bg-stone-950 px-4 pb-2 pt-2 sm:px-6" aria-label="Entity activity calendar">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className={`text-[11px] tracking-wide ${lifeLine && ready ? "text-accent-amber" : "text-stone-400"}`}>{caption}</p>
        {ready && <p className="font-mono text-[10px] text-stone-500">{timeZone}</p>}
        {!ready && evidenceStatus === "unavailable" && <button type="button" onClick={onRetry} className="min-h-9 font-mono text-[11px] text-accent-amber hover:text-stone-100">retry calendar</button>}
      </div>

      {ready && (
        <>
          <div className="overflow-x-auto md:overflow-x-visible" aria-hidden="true">
            <canvas
              ref={canvasRef}
              className={`block h-[62px] w-full min-w-[560px] md:min-w-0 ${lifeLine ? "cursor-default" : "cursor-crosshair"}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancelPointer}
              onLostPointerCapture={cancelPointer}
              onPointerLeave={() => setHoverIdx(null)}
            />
          </div>
          <details className="mt-1 border-t border-stone-900 pt-1">
            <summary className="min-h-9 cursor-pointer py-2 font-mono text-[11px] text-stone-300">Keyboard calendar controls</summary>
            <div className="flex flex-wrap items-end gap-3 pb-2">
              <label className="flex flex-col gap-1 font-mono text-[10px] text-stone-400">
                Open day
                <input type="date" min={axis.keys[0]} max={axis.keys.at(-1)} value={dayInput} onChange={(event) => setDayInput(event.target.value)} className="min-h-10 rounded-sm border border-stone-700 bg-stone-950 px-2 text-[12px] text-stone-100" />
              </label>
              <button type="button" onClick={() => dayInput && onSelectDay(dayInput)} disabled={!dayInput} className="min-h-10 rounded-sm border border-stone-700 px-3 font-mono text-[11px] text-stone-200 hover:border-stone-500 disabled:opacity-40">open evidence</button>
              {!lifeLine && (
                <>
                  <label className="flex flex-col gap-1 font-mono text-[10px] text-stone-400">
                    Filter from
                    <input type="date" min={axis.keys[0]} max={axis.keys.at(-1)} value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} className="min-h-10 rounded-sm border border-stone-700 bg-stone-950 px-2 text-[12px] text-stone-100" />
                  </label>
                  <label className="flex flex-col gap-1 font-mono text-[10px] text-stone-400">
                    Filter to
                    <input type="date" min={axis.keys[0]} max={axis.keys.at(-1)} value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} className="min-h-10 rounded-sm border border-stone-700 bg-stone-950 px-2 text-[12px] text-stone-100" />
                  </label>
                  <button type="button" onClick={applyRange} disabled={!rangeStart || !rangeEnd} className="min-h-10 rounded-sm border border-stone-700 px-3 font-mono text-[11px] text-stone-200 hover:border-stone-500 disabled:opacity-40">apply range</button>
                  <button type="button" onClick={() => onWindowChange(null)} disabled={!timeWindow} className="min-h-10 px-2 font-mono text-[11px] text-stone-300 hover:text-stone-100 disabled:opacity-40">clear range</button>
                </>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
