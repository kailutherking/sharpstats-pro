import { useMemo } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Performance } from "../lib/types";

const money = (value: number) => `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function PerformanceChart({ performance, period }: { performance: Performance | null; period: "weekly" | "monthly" }) {
  const data = useMemo(() => {
    const values = period === "weekly" ? performance?.daily ?? [] : performance?.monthly ?? [];
    let running = 0;
    return values.map((point) => {
      running += Number(point.profit_loss);
      return { label: "day" in point ? point.day : point.month, profit: Number(point.profit_loss), balance: running };
    });
  }, [performance, period]);
  return (
    <div className="h-[250px] w-full">
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 4, left: -18, bottom: 0 }}>
            <defs><linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c5f467" stopOpacity={0.22} /><stop offset="100%" stopColor="#c5f467" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#849198", fontSize: 11 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#849198", fontSize: 11 }} tickFormatter={(value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value)}`} />
            <Tooltip contentStyle={{ background: "#11171b", border: "1px solid #29343a", borderRadius: 12, color: "#eef2ed" }} formatter={(value: number) => [`${value >= 0 ? "+" : "-"}${money(value)}`, "Net P/L"]} labelStyle={{ color: "#a9b5b4" }} />
            <Area type="monotone" dataKey="balance" stroke="#c5f467" strokeWidth={2.5} fill="url(#profitFill)" activeDot={{ r: 4, fill: "#c5f467", stroke: "#11171b", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      ) : <div className="flex h-full items-center justify-center text-sm text-muted">Log settled bets to see your performance.</div>}
    </div>
  );
}
