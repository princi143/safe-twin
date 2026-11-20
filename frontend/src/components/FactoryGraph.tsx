// TRACE: interactive dependency graph. Click a station to see its blast radius.
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { LEVEL_COLOR, pct, type Factory, type LiveMachine, type Trace } from "../api";

type StationData = {
  name: string; live?: LiveMachine; selected: boolean; lossPct?: number; reroute: boolean;
};
type StationNode = Node<StationData, "station">;

function Station({ data }: NodeProps<StationNode>) {
  const { live } = data;
  const color = LEVEL_COLOR[live?.level ?? "normal"];
  const affected = data.lossPct !== undefined;
  return (
    <div
      className="w-[168px] cursor-pointer rounded-lg bg-raised px-3 py-2 transition"
      style={{
        border: `1.5px ${affected ? "dashed" : "solid"} ${data.selected ? color : affected ? "#e2a93b" : "#263242"}`,
        boxShadow: data.selected ? `0 0 0 3px ${color}33` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{data.name}</span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="num text-xl font-semibold" style={{ color }}>
          {live ? (live.status === "maintenance" ? "—" : pct(live.risk)) : "…"}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted">
          {live?.status === "maintenance" ? "maintenance" : live?.status === "throttled" ? "throttled 60%" : "failure risk"}
        </span>
      </div>
      <div className="mt-1 h-4 text-[10px]">
        {affected && <span className="text-watch">in blast radius · −{data.lossPct}% output</span>}
        {data.reroute && <span className="text-accent">can take rerouted work</span>}
        {live?.stale && !affected && !data.reroute && <span className="text-watch">telemetry missing</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { station: Station };

export function FactoryGraph({ factory, live, selected, trace, onSelect }: {
  factory: Factory; live: Record<string, LiveMachine>; selected: string; trace: Trace | null;
  onSelect: (id: string) => void;
}) {
  const nodes = useMemo<StationNode[]>(() => factory.machines.map((m) => ({
    id: m.id,
    type: "station",
    position: { x: m.pos_x, y: m.pos_y },
    draggable: false,
    data: {
      name: m.name,
      live: live[m.id],
      selected: m.id === selected,
      lossPct: trace?.affected.find((a) => a.id === m.id)?.throughput_loss_pct,
      reroute: trace?.reroute_to.includes(m.id) ?? false,
    },
  })), [factory, live, selected, trace]);

  const edges = useMemo<Edge[]>(() => factory.dependencies.map((d) => {
    const hit = trace?.edges.some(([a, b]) => a === d.source && b === d.target) ?? false;
    const stroke = hit ? "#e2a93b" : "#3a4a5e";
    return {
      id: `${d.source}-${d.target}`,
      source: d.source,
      target: d.target,
      animated: hit,
      label: `buffer ${d.buffer_capacity}`,
      style: { stroke, strokeWidth: hit ? 2 : 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
    };
  }), [factory, trace]);

  return (
    <div className="h-[330px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      />
    </div>
  );
}
