import { Bar, BarChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface TrendPoint { label: string; kcal: number }

interface TrendsChartProps {
  data: TrendPoint[];
  target: number;
  targetLabel: string;
  interval: number;
  radius: number;
  animate: boolean;
}

export default function TrendsChart({ data, target, targetLabel, interval, radius, animate }: TrendsChartProps) {
  const max = Math.max(target * 1.25, ...data.map((d) => d.kcal));
  return (
    <ResponsiveContainer width="100%" height={176} minWidth={0}>
      <BarChart data={data} margin={{ top: 16, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={interval} tick={{ fontSize: 11, fill: "var(--fg-secondary)" }} tickMargin={6} />
        <YAxis hide domain={[0, max]} />
        <ReferenceLine y={target} stroke="var(--fg-secondary)" strokeDasharray="4 4" strokeOpacity={0.7} label={{ value: targetLabel, position: "insideTopRight", fontSize: 11, fill: "var(--fg-secondary)", dy: -14 }} />
        <Bar dataKey="kcal" fill="var(--accent)" fillOpacity={0.85} radius={[radius, radius, 0, 0]} isAnimationActive={animate} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
