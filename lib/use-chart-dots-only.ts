"use client";

/**
 * Shared Recharts {@link Area} props: solid stroke, gradient fill, no vertex dots.
 * (Older builds used a narrow-viewport “dots only” mode; all charts now use solid lines.)
 */
export function areaSeriesProps(strokeColor: string, strokeWidth: number, gradientFill: string) {
  return {
    stroke: strokeColor,
    strokeWidth,
    fill: gradientFill,
    dot: false as const,
    activeDot: false as const,
    isAnimationActive: false as const,
  };
}
