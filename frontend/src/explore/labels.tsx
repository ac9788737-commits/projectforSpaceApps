import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { create } from "zustand";

/**
 * 3D-anchored HTML labels rendered in the normal DOM tree (no extra React roots).
 * `<Anchor>` lives inside the canvas and registers its content; `<LabelLayer>` renders the
 * content over the canvas and moves it every frame to the projected anchor position.
 */
export interface LabelEntry {
  content: ReactNode;
  object: THREE.Object3D;
  center: boolean;
  offset: [number, number];
  z: number;
  autoFlip: boolean;
}

interface LabelState {
  entries: Record<string, LabelEntry>;
  put: (id: string, entry: LabelEntry) => void;
  remove: (id: string) => void;
}

const useLabels = create<LabelState>((set) => ({
  entries: {},
  put: (id, entry) => set((s) => ({ entries: { ...s.entries, [id]: entry } })),
  remove: (id) =>
    set((s) => {
      const next = { ...s.entries };
      delete next[id];
      return { entries: next };
    }),
}));

const view = { camera: null as THREE.Camera | null, width: 1, height: 1 };

/** Keeps the projection inputs current; mount once inside the canvas. */
export function LabelCamera() {
  useFrame(({ camera, size }) => {
    view.camera = camera;
    view.width = size.width;
    view.height = size.height;
  });
  return null;
}

let counter = 0;

export function Anchor({
  position = [0, 0, 0],
  center = true,
  offset = [0, 0],
  z = 10,
  autoFlip = false,
  children,
}: {
  position?: [number, number, number];
  center?: boolean;
  offset?: [number, number];
  z?: number;
  autoFlip?: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const id = useRef(`label-${++counter}`);
  const put = useLabels((s) => s.put);
  const remove = useLabels((s) => s.remove);
  useLayoutEffect(() => {
    if (group.current) put(id.current, { content: children, object: group.current, center, offset, z, autoFlip });
  });
  useEffect(() => {
    const key = id.current;
    return () => remove(key);
  }, [remove]);
  return <group ref={group} position={position} />;
}

const _v = new THREE.Vector3();

function LabelItem({ entry }: { entry: LabelEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = ref.current;
      if (el && view.camera) {
        entry.object.getWorldPosition(_v);
        _v.project(view.camera);
        const visible = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
        el.style.display = visible ? "" : "none";
        if (visible) {
          const x = ((_v.x + 1) / 2) * view.width + entry.offset[0];
          const y = ((1 - _v.y) / 2) * view.height + entry.offset[1];
          // Cards near the right edge open to the left so they never hide under the right panel.
          const flip = entry.autoFlip && x > view.width * 0.5;
          const flipY = entry.autoFlip && y > view.height * 0.45;
          el.dataset.flip = flip ? "1" : "0";
          el.dataset.flipy = flipY ? "1" : "0";
          const shift = entry.center ? " translate(-50%, -50%)" : ` translate(${flip ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`;
          el.style.transform = `translate(${x}px, ${y}px)${shift}`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [entry]);
  return (
    <div ref={ref} className="group/label absolute left-0 top-0" style={{ zIndex: entry.z, display: "none" }}>
      {entry.content}
    </div>
  );
}

/** DOM layer over the canvas; must share the canvas' positioned container. */
export function LabelLayer() {
  const entries = useLabels((s) => s.entries);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {Object.entries(entries).map(([id, entry]) => (
        <LabelItem key={id} entry={entry} />
      ))}
    </div>
  );
}
