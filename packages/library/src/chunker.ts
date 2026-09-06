// ============================================================
// @seneca/library — pure markdown chunker primitives.
//
// rag-dedup (May 31, master-plan spec #17): the sliding-window
// stepper lives here, in-package, so it's a pure, DB-free,
// embed-free unit (no dotenv, no Voyage, no DB). scripts/ingest-library.ts
// imports it; rag-dedup.test.ts tests it directly. No embedding
// logic lives here — only window-boundary math.
// ============================================================

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;

export interface WindowSpan {
  start: number;
  end: number;
}

// Pure sliding-window stepper for an oversized section [sectionStart, sectionEnd).
// Splits into <=chunkSize windows with `overlap`, cutting at \n\n / \n where
// possible. FIX (rag-dedup, May 31): the previous loop could re-emit a short tail
// already fully covered by the prior window — after `cursor = windowEnd - overlap`
// rewound to within the prior window's [start,end), the final window's slice was a
// byte-identical suffix of the prior chunk. Guard: skip any window whose
// [start,end) ends at/before the previously-emitted window's end (wholly contained
// → no forward progress without re-emitting covered text) and stop the walk there.
// No embedding logic touched.
export function slidingWindowSpans(
  body: string,
  sectionStart: number,
  sectionEnd: number,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): WindowSpan[] {
  const spans: WindowSpan[] = [];
  let cursor = sectionStart;
  let prevEnd = -1;

  while (cursor < sectionEnd) {
    let windowEnd = Math.min(cursor + chunkSize, sectionEnd);
    if (windowEnd < sectionEnd) {
      // Prefer to cut at \n\n within the last `overlap` chars; fall back to last \n; else hard cut.
      const tailStart = Math.max(cursor + chunkSize - overlap, cursor + 1);
      const tail = body.slice(tailStart, windowEnd);
      const paraIdx = tail.lastIndexOf("\n\n");
      const lineIdx = tail.lastIndexOf("\n");
      if (paraIdx !== -1) windowEnd = tailStart + paraIdx + 2;
      else if (lineIdx !== -1) windowEnd = tailStart + lineIdx + 1;
    }

    // Repeated-tail guard: if this window ends at/before the previous window's end,
    // its content is wholly contained in the chunk we already emitted — skip it and
    // stop (no forward progress is possible without re-emitting covered text).
    if (windowEnd <= prevEnd) break;

    spans.push({ start: cursor, end: windowEnd });
    prevEnd = windowEnd;

    if (windowEnd >= sectionEnd) break; // reached the section tail — done.

    cursor = windowEnd - overlap;
    if (cursor <= sectionStart) cursor = windowEnd; // safety: never rewind before the section start.
  }

  return spans;
}
