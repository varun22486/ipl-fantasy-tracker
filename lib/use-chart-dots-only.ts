"use client";

import { useEffect, useState } from "react";

const MOBILE_CHART_MQ = "(max-width: 640px)";

/** True on narrow viewports — line/area series render as dots only (no stroke/fill). */
export function useChartDotsOnly(): boolean {
  const [dotsOnly, setDotsOnly] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_CHART_MQ);
    const apply = () => setDotsOnly(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return dotsOnly;
}

type DotShape = { r: number; fill: string; stroke?: string; strokeWidth?: number };

/**
 * Recharts <Area /> props: on phone, hide line and gradient fill so only {@link dot} markers show.
 */
export function areaSeriesProps(
  dotsOnly: boolean,
  strokeColor: string,
  strokeWidth: number,
  gradientFill: string,
  dot: DotShape,
  activeDot?: { r: number }
) {
  if (dotsOnly) {
    const r = Math.max(dot.r + 1, 6);
    return {
      stroke: strokeColor,
      strokeWidth: 0,
      fill: "none" as const,
      dot: { ...dot, r, stroke: dot.stroke ?? "white", strokeWidth: dot.strokeWidth ?? 2 },
      activeDot: { r: activeDot ? Math.max(activeDot.r + 1, 9) : 9 },
      isAnimationActive: false as const,
    };
  }
  return {
    stroke: strokeColor,
    strokeWidth,
    fill: gradientFill,
    dot,
    ...(activeDot ? { activeDot } : {}),
  };
}
