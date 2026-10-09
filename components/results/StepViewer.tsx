"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { wallSolids, type SceneDoc, type WallSolid } from "@/lib/results/scene";

const COLORS: Record<string, number> = {
  background: 0xe4ded4,
  ritorno: 0xd5cfc4,
  terreno: 0xc8bba8,
  muro: 0xe4ded4,
};

function outline(solid: WallSolid, withHoles: boolean) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(solid.width, 0);
  shape.lineTo(solid.width, solid.height);
  shape.lineTo(0, solid.height);
  shape.closePath();
  if (withHoles) {
    for (const hole of solid.holes) {
      const path = new THREE.Path();
      path.moveTo(hole.u0, hole.v0);
      path.lineTo(hole.u0, hole.v1);
      path.lineTo(hole.u1, hole.v1);
      path.lineTo(hole.u1, hole.v0);
      path.closePath();
      shape.holes.push(path);
    }
  }
  return new THREE.ExtrudeGeometry(shape, { depth: solid.thickness, bevelEnabled: false });
}

function meshFor(solid: WallSolid) {
  try {
    return outline(solid, solid.holes.length > 0);
  } catch {
    return outline(solid, false);
  }
}

function addSolid(group: THREE.Group, solid: WallSolid) {
  const geometry = meshFor(solid);
  geometry.translate(0, 0, -solid.thickness);
  const material = new THREE.MeshStandardMaterial({
    color: COLORS[solid.role] ?? 0xd0d0d0,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...solid.axisU),
    new THREE.Vector3(...solid.axisV),
    new THREE.Vector3(...solid.normal),
  );
  basis.setPosition(...solid.origin);
  mesh.matrix.copy(basis);
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    new THREE.LineBasicMaterial({ color: 0x2c2c2c, transparent: true, opacity: 0.4 }),
  );
  edges.matrix.copy(basis);
  edges.matrixAutoUpdate = false;
  group.add(edges);
}

export function StepViewer({ scene }: { scene: SceneDoc }) {
  const host = useRef<HTMLDivElement>(null);
  const resetView = useRef<(() => void) | null>(null);
  const [lost, setLost] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const solids = wallSolids(scene);
    if (solids.length === 0) {
      setEmpty(true);
      return;
    }

    const view = new THREE.Scene();
    view.background = new THREE.Color(0xd7d7d7);
    const group = new THREE.Group();
    for (const solid of solids) addSolid(group, solid);
    group.updateMatrixWorld(true);
    view.add(group);
    view.add(new THREE.HemisphereLight(0xffffff, 0xcfc8bc, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(4, 8, 6);
    view.add(sun);

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.55, 0.8);
    const eye = center.clone().add(new THREE.Vector3(radius * 0.45, radius * 0.28, radius * 1.2));
    const camera = new THREE.PerspectiveCamera(42, 1, 0.04, Math.max(radius * 40, 20));
    camera.position.copy(eye);
    camera.lookAt(center);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.touchAction = "none";
    parent.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.minDistance = radius * 0.15;
    controls.maxDistance = radius * 8;
    controls.update();

    const homeEye = eye.clone();
    const homeTarget = center.clone();
    resetView.current = () => {
      camera.position.copy(homeEye);
      controls.target.copy(homeTarget);
      controls.update();
    };

    const onLost = (event: Event) => {
      event.preventDefault();
      setLost(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);

    let frame = 0;
    const draw = () => {
      frame = window.requestAnimationFrame(draw);
      controls.update();
      renderer.render(view, camera);
    };
    const resize = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width < 2 || height < 2) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    draw();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      view.traverse((object) => {
        const drawn = object as THREE.Mesh;
        drawn.geometry?.dispose();
        const material = drawn.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
    };
  }, [scene]);

  return (
    <div className="viewer-stage">
      <div ref={host} className="viewer-canvas" />
      {empty ? <p className="viewer-error">Nessuna parete da disegnare.</p> : null}
      {lost ? <p className="viewer-error">La vista 3D si è interrotta. Ricarica la pagina.</p> : null}
      <button type="button" className="viewer-reset" onClick={() => resetView.current?.()}>
        Ripristina vista
      </button>
    </div>
  );
}
