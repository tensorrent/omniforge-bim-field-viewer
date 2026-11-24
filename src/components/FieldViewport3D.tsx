import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import type { BimElement, BimSystemCategory } from "../types/bim";

const CATEGORY_COLORS: Record<BimSystemCategory, number> = {
  switchgear: 0xe11d48,
  panelboard: 0x2563eb,
  transformer: 0xf59e0b,
  conduit: 0x10b981,
  lighting: 0xfacc15,
  fire_alarm: 0xef4444,
  disconnect: 0x8b5cf6,
  structure: 0x64748b,
};

interface FieldViewport3DProps {
  elements: BimElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  xrayConduits: boolean;
}

export const FieldViewport3D: React.FC<FieldViewport3DProps> = ({
  elements,
  selectedId,
  onSelect,
  xrayConduits,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectCbRef = useRef(onSelect);
  selectCbRef.current = onSelect;
  const meshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const selectedRingRef = useRef<THREE.BoxHelper | null>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 640, host.clientHeight || 420);
    renderer.shadowMap.enabled = true;
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0f172a");

    const camera = new THREE.PerspectiveCamera(48, (host.clientWidth || 640) / Math.max(1, host.clientHeight || 420), 0.1, 300);

    scene.add(new THREE.HemisphereLight("#e2e8f0", "#1e293b", 1.1));
    const sun = new THREE.DirectionalLight("#ffffff", 1.45);
    sun.position.set(16, 28, 18);
    sun.castShadow = true;
    scene.add(sun);

    // Concrete electrical room / slab floor + architectural grid
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 24),
      new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.92, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.GridHelper(34, 34, 0x334155, 0x1e293b));

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    const map = new Map<string, THREE.Mesh>();

    for (const el of elements) {
      const geom =
        el.category === "conduit" && Math.max(el.size[0], el.size[2]) > 1.0
          ? new THREE.BoxGeometry(el.size[0], el.size[1], el.size[2])
          : new THREE.BoxGeometry(el.size[0], el.size[1], el.size[2]);
      const baseColor = CATEGORY_COLORS[el.category] ?? 0x38bdf8;
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.42,
        metalness: el.category === "conduit" ? 0.6 : 0.25,
        transparent: xrayConduits && el.category !== "conduit" && el.category !== "fire_alarm",
        opacity: xrayConduits && el.category !== "conduit" && el.category !== "fire_alarm" ? 0.35 : 1.0,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(el.position[0], el.position[1], el.position[2]);
      if (el.rotationY) mesh.rotation.y = el.rotationY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { bimId: el.id };
      meshGroup.add(mesh);
      map.set(el.id, mesh);
    }
    meshMapRef.current = map;

    const ringMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true }));
    const helper = new THREE.BoxHelper(ringMesh, 0x38bdf8);
    helper.visible = false;
    scene.add(helper);
    selectedRingRef.current = helper;

    // Lightweight touch/mouse orbit + raycast tap selection
    let yaw = 0.58;
    let pitch = 0.52;
    let radius = 24;
    const target = new THREE.Vector3(0, 1.5, 0);
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;

    const updateCam = () => {
      const cp = Math.cos(pitch);
      camera.position.set(
        target.x + Math.sin(yaw) * cp * radius,
        target.y + Math.sin(pitch) * radius,
        target.z + Math.cos(yaw) * cp * radius,
      );
      camera.lookAt(target);
    };
    updateCam();

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();

    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.hypot(dx, dy) > 4) moved = true;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw -= dx * 0.007;
      pitch = Math.max(0.12, Math.min(1.42, pitch + dy * 0.007));
      updateCam();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(meshGroup.children, false);
        if (hits.length > 0 && typeof hits[0].object.userData?.bimId === "string") {
          selectCbRef.current(hits[0].object.userData.bimId);
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      radius = Math.max(5, Math.min(60, radius * (1 + e.deltaY * 0.001)));
      updateCam();
    };

    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    const onResize = () => {
      const w = host.clientWidth || 640;
      const h = host.clientHeight || 420;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    };
  }, [elements, xrayConduits]);

  useEffect(() => {
    const helper = selectedRingRef.current;
    if (!helper) return;
    const mesh = selectedId ? meshMapRef.current.get(selectedId) : undefined;
    if (mesh) {
      helper.setFromObject(mesh);
      helper.visible = true;
    } else {
      helper.visible = false;
    }
  }, [selectedId, elements]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: 360, position: "relative", touchAction: "none" }}
      aria-label="Interactive 3D Field Electrical BIM Viewport"
    />
  );
};
