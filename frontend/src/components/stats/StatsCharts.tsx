import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { StatFormat } from "../../lib/statsTypes";
import { formatStat } from "../../lib/statsFormat";
import { EmptyState } from "./StatsUi";

const LIME = "#c5f467";
const ROSE = "#fb7185";
export const SERIES_COLORS = ["#c5f467", "#7dd3fc", "#fbbf24", "#f0abfc"];
const axis = { axisLine: false, tickLine: false, tick: { fill: "#849198", fontSize: 10 } };
const tooltipStyle = { background: "#11171b", border: "1px solid #29343a", borderRadius: 12, color: "#eef2ed", fontSize: 12 };

export interface TrendPoint {
  label: string;
  value: number | null;
  rolling: number | null;
  opponent: string;
}

/** Game-by-game bars coloured by whether they cleared the line, with a rolling 5-game average. */
export function PropTrendChart({ points, line, direction, format, label }: { points: TrendPoint[]; line: number | null; direction: "over" | "under"; format: StatFormat; label: string }) {
  if (!points.some((point) => point.value !== null)) return <EmptyState>No games logged in this window.</EmptyState>;
  const hit = (value: number | null) => value !== null && line !== null && (direction === "over" ? value >= line : value <= line);
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" {...axis} dy={8} interval="preserveStartEnd" minTickGap={12} />
          <YAxis {...axis} allowDecimals={format !== "int"} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: "#a9b5b4" }}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            formatter={(value: number, name: string) => [formatStat(value, name === "rolling" ? (format === "int" ? "dec1" : format) : format), name === "rolling" ? "5-game avg" : label]}
            labelFormatter={(text: string, payload) => `${text}${payload?.[0]?.payload?.opponent ? ` · ${payload[0].payload.opponent}` : ""}`}
          />
          {line !== null && <ReferenceLine y={line} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: `Line ${formatStat(line, format)}`, fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }} />}
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={26}>
            {points.map((point, index) => <Cell key={index} fill={line === null ? LIME : hit(point.value) ? LIME : ROSE} fillOpacity={line === null || hit(point.value) ? 0.85 : 0.55} />)}
          </Bar>
          <Line dataKey="rolling" type="monotone" stroke="#7dd3fc" strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HistoryChart({ data, format, label }: { data: Array<{ label: string; value: number | null }>; format: StatFormat; label: string }) {
  if (!data.some((point) => point.value !== null)) return <EmptyState>No historical seasons available for this stat.</EmptyState>;
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" {...axis} dy={8} />
          <YAxis {...axis} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} formatter={(value: number) => [formatStat(value, format), label]} />
          <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={38}>
            {data.map((_, index) => <Cell key={index} fill={LIME} fillOpacity={index === data.length - 1 ? 0.95 : 0.45} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TeamScoringChart({ data, pointsLabel }: { data: Array<{ label: string; pointsFor: number; pointsAgainst: number; opponent: string }>; pointsLabel: string }) {
  if (!data.length) return <EmptyState>No completed games yet this season.</EmptyState>;
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" {...axis} dy={8} interval="preserveStartEnd" minTickGap={12} />
          <YAxis {...axis} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(text: string, payload) => `${text}${payload?.[0]?.payload?.opponent ? ` · ${payload[0].payload.opponent}` : ""}`} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#849198" }} />
          <Line name={`${pointsLabel} scored`} dataKey="pointsFor" type="monotone" stroke={LIME} strokeWidth={2.5} dot={{ r: 2.5 }} />
          <Line name={`${pointsLabel} allowed`} dataKey="pointsAgainst" type="monotone" stroke={ROSE} strokeWidth={2} dot={{ r: 2.5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One line per compared entity, game index on the x-axis (most recent on the right). */
export function CompareTrendChart({ series, format, label }: { series: Array<{ name: string; values: Array<number | null> }>; format: StatFormat; label: string }) {
  const length = Math.max(0, ...series.map((item) => item.values.length));
  if (!length) return <EmptyState>No recent games to chart.</EmptyState>;
  const data = Array.from({ length }, (_, index) => {
    const row: Record<string, number | string | null> = { label: index === length - 1 ? "Latest" : `G-${length - 1 - index}` };
    series.forEach((item) => { row[item.name] = item.values[item.values.length - length + index] ?? null; });
    return row;
  });
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" {...axis} dy={8} />
          <YAxis {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [formatStat(value, format), `${name} · ${label}`]} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#849198" }} />
          {series.map((item, index) => <Line key={item.name} dataKey={item.name} type="monotone" stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompareBarChart({ data, format, label }: { data: Array<{ name: string; value: number | null }>; format: StatFormat; label: string }) {
  if (!data.some((item) => item.value !== null)) return <EmptyState>No values to compare for this stat.</EmptyState>;
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="name" {...axis} dy={8} />
          <YAxis {...axis} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} formatter={(value: number) => [formatStat(value, format), label]} />
          <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={48}>
            {data.map((_, index) => <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
