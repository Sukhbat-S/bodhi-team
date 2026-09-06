export type EntityEscapeLayer = "detail" | "day" | "range" | null;

export function entityEscapeLayer(state: {
  detailVisible: boolean;
  dayVisible: boolean;
  rangeActive: boolean;
}): EntityEscapeLayer {
  if (state.detailVisible) return "detail";
  if (state.dayVisible) return "day";
  if (state.rangeActive) return "range";
  return null;
}
