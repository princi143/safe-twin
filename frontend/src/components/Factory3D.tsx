// 3D view of the production cell. Each station is built from the same three monitored parts
// (bearing, drive motor, housing) so the part where a fault is developing can be seen directly.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { LEVEL_COLOR, PART_COLOR, pct, type ComponentState, type Factory, type LiveMachine, type Machine, type Trace } from "../api";

const STEEL = "#EDE6F0";
const DARK = "#A584AD";
const place = (m: Machine): [number, number, number] => [(m.pos_x - 530) / 88, 0, (m.pos_y - 90) / 42];

/** One monitored part. Healthy parts are steel; a part under watch or at fault is coloured, and the fault location pulses. */
function Part({ state, children, position, rotation }: {
  state?: ComponentState; children: React.ReactNode; position: [number, number, number]; rotation?: [number, number, number];
}) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const status = state?.status ?? "unknown";
  const flagged = status === "watch" || status === "fault";
  useFrame(({ clock }) => {
    if (!mat.current) return;
    mat.current.emissiveIntensity = state?.fault_location ? 0.6 + Math.sin(clock.getElapsedTime() * 6) * 0.45 : flagged ? 0.35 : 0;
  });
  const color = flagged ? PART_COLOR[status] : STEEL;
  return (
    <mesh position={position} rotation={rotation}>
      {children}
      <meshStandardMaterial ref={mat} color={color} emissive={flagged ? color : "#000000"} metalness={0.4} roughness={0.5} />
    </mesh>
  );
}

/** The body that makes each kind of station recognisable. `spin` is rotated while the station runs. */
function Body({ kind, spin, ghost }: { kind: string; spin: React.RefObject<THREE.Group | null>; ghost: boolean }) {
  const shell = <meshStandardMaterial color={DARK} metalness={0.3} roughness={0.7} transparent opacity={ghost ? 0.3 : 0.95} />;
  const metal = <meshStandardMaterial color="#6B4547" metalness={0.6} roughness={0.35} />;
  if (kind === "cnc") {
    return (
      <group>
        <mesh position={[0, 1.15, -0.25]}><boxGeometry args={[1.9, 1.5, 1.2]} />{shell}</mesh>
        <group ref={spin} position={[0.35, 0.95, 0.15]}>
          <mesh><cylinderGeometry args={[0.07, 0.07, 0.6, 12]} />{metal}</mesh>
          <mesh position={[0.1, -0.25, 0]}><boxGeometry args={[0.12, 0.08, 0.04]} />{metal}</mesh>
        </group>
      </group>
    );
  }
  if (kind === "deburr") {
    return (
      <group>
        <mesh position={[0, 0.75, -0.2]}><boxGeometry args={[1.6, 0.7, 1.0]} />{shell}</mesh>
        <group ref={spin} position={[0.35, 1.35, 0.1]} rotation={[0, 0, Math.PI / 2]}>
          <mesh><cylinderGeometry args={[0.32, 0.32, 0.18, 20]} />{metal}</mesh>
          <mesh position={[0.2, 0, 0]}><boxGeometry args={[0.1, 0.2, 0.06]} />{metal}</mesh>
        </group>
      </group>
    );
  }
  if (kind === "wash") {
    return (
      <group>
        <mesh position={[0, 1.0, -0.2]}><cylinderGeometry args={[0.75, 0.75, 1.3, 24]} />{shell}</mesh>
        <group ref={spin} position={[0, 1.75, -0.2]}>
          <mesh><boxGeometry args={[1.0, 0.06, 0.1]} />{metal}</mesh>
        </group>
      </group>
    );
  }
  if (kind === "assembly") {
    return (
      <group>
        <mesh position={[0, 0.55, -0.2]}><cylinderGeometry args={[0.4, 0.5, 0.5, 16]} />{shell}</mesh>
        <group ref={spin} position={[0, 0.8, -0.2]}>
          <mesh position={[0, 0.45, 0]}><boxGeometry args={[0.16, 0.9, 0.16]} />{metal}</mesh>
          <mesh position={[0.4, 0.9, 0]}><boxGeometry args={[0.9, 0.14, 0.14]} />{metal}</mesh>
          <mesh position={[0.85, 0.72, 0]}><boxGeometry args={[0.1, 0.3, 0.1]} />{metal}</mesh>
        </group>
      </group>
    );
  }
  return ( // inspect: camera gantry
    <group>
      {[-0.6, 0.6].map((x) => <mesh key={x} position={[x, 1.0, -0.2]}><boxGeometry args={[0.1, 1.5, 0.1]} />{shell}</mesh>)}
      <mesh position={[0, 1.75, -0.2]}><boxGeometry args={[1.3, 0.1, 0.1]} />{shell}</mesh>
      <group ref={spin} position={[0, 1.5, -0.2]}>
        <mesh><boxGeometry args={[0.3, 0.3, 0.3]} />{metal}</mesh>
        <mesh position={[0, -0.22, 0]}><cylinderGeometry args={[0.08, 0.11, 0.14, 12]} /><meshStandardMaterial color="#A584AD" emissive="#A584AD" emissiveIntensity={0.8} /></mesh>
      </group>
    </group>
  );
}

function Station({ machine, live, selected, inRadius, onSelect }: {
  machine: Machine; live?: LiveMachine; selected: boolean; inRadius: boolean; onSelect: (id: string) => void;
}) {
  const spin = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const level = live?.level ?? "normal";
  const color = LEVEL_COLOR[level];
  const speed = live?.status === "maintenance" ? 0 : live?.status === "throttled" ? 0.6 : 1;
  const part = (key: string) => live?.components.find((c) => c.key === key);

  useFrame(({ clock }, delta) => {
    if (spin.current) {
      if (machine.kind === "assembly") spin.current.rotation.y = Math.sin(clock.getElapsedTime() * 1.2 * speed) * 0.9 * (speed ? 1 : 0);
      else if (machine.kind === "inspect") spin.current.position.x = Math.sin(clock.getElapsedTime() * 1.5 * speed) * 0.35;
      else spin.current.rotation[machine.kind === "deburr" ? "x" : "y"] += delta * 9 * speed;
    }
    if (halo.current) {
      const u = (clock.getElapsedTime() * 0.8) % 1;
      halo.current.scale.setScalar(1 + u * 0.6);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.5;
    }
  });

  return (
    <group position={place(machine)} onClick={(e) => { e.stopPropagation(); onSelect(machine.id); }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = "auto"; }}>
      {/* plinth, tinted by risk level */}
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[2.3, 0.24, 2.0]} />
        <meshStandardMaterial color={selected ? "#553638" : "#6B4547"} metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.28, 1.36, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial color={selected ? color : inRadius ? "#C4871B" : "#BFA5C7"} side={THREE.DoubleSide} />
      </mesh>
      {level === "high" && (
        <mesh ref={halo} position={[0, 0.26, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.4, 1.5, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}

      <Body kind={machine.kind} spin={spin} ghost={selected} />

      {/* drive unit: the three monitored parts, the same on every station */}
      <group position={[-0.45, 0.5, 0.62]}>
        <Part state={part("housing")} position={[0.45, 0, 0]}><boxGeometry args={[1.5, 0.42, 0.5]} /></Part>
        <Part state={part("motor")} position={[0, 0.45, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.24, 0.24, 0.6, 20]} /></Part>
        <Part state={part("bearing")} position={[0.52, 0.45, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.2, 0.085, 12, 24]} /></Part>
        <mesh position={[0.75, 0.45, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.55, 10]} />
          <meshStandardMaterial color="#6B4547" metalness={0.6} roughness={0.35} />
        </mesh>
      </group>

      {/* status beacon */}
      <mesh position={[-0.95, 2.05, -0.75]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[-0.95, 1.1, -0.75]}><cylinderGeometry args={[0.025, 0.025, 1.9, 6]} /><meshStandardMaterial color={DARK} /></mesh>

    </group>
  );
}

function Conveyor({ from, to, running, alert }: { from: Machine; to: Machine; running: boolean; alert: boolean }) {
  const parts = useRef<THREE.Group>(null);
  const { a, b, length, angle, mid } = useMemo(() => {
    const a = new THREE.Vector3(...place(from)).setY(0.42);
    const b = new THREE.Vector3(...place(to)).setY(0.42);
    const dir = b.clone().sub(a);
    return { a, b, length: dir.length() - 2.3, angle: Math.atan2(-dir.z, dir.x), mid: a.clone().lerp(b, 0.5) };
  }, [from, to]);
  const t = useRef(0);
  useFrame((_, delta) => {
    if (!parts.current) return;
    if (running) t.current += delta * 0.22;
    parts.current.children.forEach((child, i) => {
      const u = (t.current + i / 3) % 1;
      const start = a.clone().lerp(b, 1.15 / a.distanceTo(b));
      const end = b.clone().lerp(a, 1.15 / a.distanceTo(b));
      child.position.copy(start.lerp(end, u)).setY(0.56);
    });
  });
  return (
    <group>
      <mesh position={mid} rotation={[0, angle, 0]}>
        <boxGeometry args={[length, 0.1, 0.5]} />
        <meshStandardMaterial color={alert ? "#C4871B" : "#8A6F80"} metalness={0.2} roughness={0.8} />
      </mesh>
      <group ref={parts}>
        {[0, 1, 2].map((i) => (
          <mesh key={i}><boxGeometry args={[0.22, 0.16, 0.22]} /><meshStandardMaterial color={running ? "#FFFFFF" : "#BFA5C7"} metalness={0.5} roughness={0.4} /></mesh>
        ))}
      </group>
    </group>
  );
}

/** Keeps the HTML name tags (drawn outside the canvas) pinned above their stations. */
function LabelProjector({ machines, labels }: { machines: Machine[]; labels: React.RefObject<Record<string, HTMLDivElement | null>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const m of machines) {
      const el = labels.current[m.id];
      if (!el) continue;
      const [x, , z] = place(m);
      v.set(x, 2.5, z).project(camera);
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      el.style.opacity = v.z < 1 ? "1" : "0";
    }
  });
  return null;
}

export default function Factory3D({ factory, live, selected, trace, onSelect }: {
  factory: Factory; live: Record<string, LiveMachine>; selected: string; trace: Trace | null; onSelect: (id: string) => void;
}) {
  const byId = useMemo(() => Object.fromEntries(factory.machines.map((m) => [m.id, m])), [factory]);
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  return (
    <div className="relative h-full w-full overflow-hidden">
    <Canvas camera={{ position: [0.8, 5.8, 9.6], fov: 40 }} dpr={[1, 2]} style={{ background: "transparent" }}>
      <LabelProjector machines={factory.machines} labels={labels} />
      <hemisphereLight args={["#ffffff", "#D2B4DC", 1.1]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[6, 12, 8]} intensity={1.6} />
      <directionalLight position={[-8, 6, -6]} intensity={0.5} color="#D2B4DC" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[40, 24]} />
        <meshStandardMaterial color="#E9DBEF" roughness={0.95} />
      </mesh>
      <gridHelper args={[40, 40, "#D2B4DC", "#DDCAE5"]} />
      {factory.dependencies.map((d) => (
        <Conveyor key={`${d.source}-${d.target}`} from={byId[d.source]} to={byId[d.target]}
          running={live[d.source]?.status !== "maintenance"}
          alert={trace?.edges.some(([a, b]) => a === d.source && b === d.target) ?? false} />
      ))}
      {factory.machines.map((m) => (
        <Station key={m.id} machine={m} live={live[m.id]} selected={m.id === selected}
          inRadius={trace?.affected_ids.includes(m.id) ?? false} onSelect={onSelect} />
      ))}
      <OrbitControls enablePan={false} minDistance={5} maxDistance={22} maxPolarAngle={Math.PI / 2.15} target={[0, 0.9, 0]} />
    </Canvas>
      <div className="pointer-events-none absolute inset-0">
        {factory.machines.map((m) => {
          const l = live[m.id];
          const color = LEVEL_COLOR[l?.level ?? "normal"];
          const fault = l?.status !== "maintenance" ? l?.components.find((c) => c.fault_location) : undefined;
          return (
            <div key={m.id} ref={(el) => { labels.current[m.id] = el; }} style={{ borderColor: m.id === selected ? color : "#DCC8E3" }}
              className="absolute left-0 top-0 whitespace-nowrap rounded-lg border bg-[#ffffffee] px-2.5 py-1 text-center text-[11px] leading-tight shadow-sm">
              <div className="font-semibold">{m.name}</div>
              <div className="num" style={{ color }}>
                {l?.status === "maintenance" ? "in maintenance" : l ? `${pct(l.risk)} risk${l.status === "throttled" ? " · 60% load" : ""}` : "…"}
              </div>
              {fault && <div className="text-high">fault: {fault.name.toLowerCase()}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
