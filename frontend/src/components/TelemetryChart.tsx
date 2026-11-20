// DETECT + PREDICT: live sensor telemetry (top) and the failure-risk score (bottom) with ECharts.
import { LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { Sample } from "../api";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, AxisPointerComponent, CanvasRenderer]);

const AXIS = { axisLine: { lineStyle: { color: "#263242" } }, axisLabel: { color: "#8496ab", fontSize: 10 }, splitLine: { lineStyle: { color: "#1c2632" } } };

export function TelemetryChart({ samples }: { samples: Sample[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const c = echarts.init(el.current!);
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => { ro.disconnect(); c.dispose(); };
  }, []);

  useEffect(() => {
    const times = samples.map((s) => new Date(s.ts).toLocaleTimeString([], { hour12: false }));
    chart.current?.setOption({
      animation: false,
      textStyle: { fontFamily: "ui-monospace, Menlo, Consolas, monospace" },
      legend: { top: 0, left: "center", textStyle: { color: "#8496ab", fontSize: 11 }, itemWidth: 14, itemHeight: 2, icon: "rect" },
      tooltip: { trigger: "axis", backgroundColor: "#19222e", borderColor: "#263242", textStyle: { color: "#dce5ef", fontSize: 11 } },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 42, right: 46, top: 30, height: 120 },
        { left: 42, right: 46, top: 178, height: 62 },
      ],
      xAxis: [
        { type: "category", data: times, gridIndex: 0, ...AXIS, axisLabel: { show: false }, axisTick: { show: false } },
        { type: "category", data: times, gridIndex: 1, ...AXIS, axisTick: { show: false } },
      ],
      yAxis: [
        { type: "value", name: "mm/s", gridIndex: 0, scale: true, ...AXIS, nameTextStyle: { color: "#8496ab", fontSize: 10 } },
        { type: "value", name: "°C", gridIndex: 0, scale: true, position: "right", ...AXIS, splitLine: { show: false }, nameTextStyle: { color: "#8496ab", fontSize: 10 } },
        { type: "value", name: "risk", gridIndex: 1, min: 0, max: 1, interval: 0.5, ...AXIS, nameTextStyle: { color: "#8496ab", fontSize: 10 } },
      ],
      series: [
        { name: "Vibration", type: "line", data: samples.map((s) => s.vibration), showSymbol: false, lineStyle: { width: 1.5 }, color: "#4cc2d6", xAxisIndex: 0, yAxisIndex: 0 },
        { name: "Temperature", type: "line", data: samples.map((s) => s.temperature), showSymbol: false, lineStyle: { width: 1.5 }, color: "#c58af9", xAxisIndex: 0, yAxisIndex: 1 },
        {
          name: "Failure risk", type: "line", data: samples.map((s) => s.risk), showSymbol: false, color: "#ef5b5b",
          lineStyle: { width: 1.5 }, areaStyle: { opacity: 0.12 }, xAxisIndex: 1, yAxisIndex: 2,
          markLine: {
            silent: true, symbol: "none", label: { color: "#8496ab", fontSize: 9, position: "end" },
            data: [
              { yAxis: 0.3, name: "watch", lineStyle: { color: "#e2a93b", type: "dashed" }, label: { formatter: "watch" } },
              { yAxis: 0.6, name: "high", lineStyle: { color: "#ef5b5b", type: "dashed" }, label: { formatter: "high" } },
            ],
          },
        },
      ],
    });
  }, [samples]);

  return <div ref={el} className="h-[270px] w-full" role="img" aria-label="Live vibration, temperature and failure-risk chart" />;
}
