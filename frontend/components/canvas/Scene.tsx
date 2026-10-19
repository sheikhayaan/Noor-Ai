"use client";

import { Canvas } from "@react-three/fiber";
import { Environment, PerformanceMonitor, Preload } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import type { SmoothMouseRef } from "@/hooks/useMouse";
import { NoorCore } from "@/components/canvas/NoorCore";

export function Scene({ mouseRef }: { mouseRef: SmoothMouseRef }) {
  const [dpr, setDpr] = useState<[number, number]>([1, 2]);
  const [lowPower, setLowPower] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    setLowPower(reducedMotion || narrow || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4));
  }, []);

  return (
    <div className="fixed inset-0 z-0 bg-noor-bg">
      <Canvas
        dpr={dpr}
        camera={{ position: [0, 0.2, 10.8], fov: 48, near: 0.1, far: 90 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          stencil: false,
          depth: true,
        }}
        onCreated={({ gl }) => {
          gl.setClearColor("#020308", 1);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
        }}
      >
        <PerformanceMonitor
          bounds={(refreshRate) => (refreshRate > 90 ? [58, 120] : [45, 60])}
          onDecline={() => setDpr([1, 1.25])}
          onIncline={() => setDpr([1, 2])}
        />
        <Suspense fallback={null}>
          <color attach="background" args={["#020308"]} />
          <fog attach="fog" args={["#020308", 11, 45]} />
          <ambientLight intensity={0.16} />
          <pointLight color="#67ffeb" decay={2} distance={22} intensity={7.5} position={[0, 2.2, 4.5]} />
          <pointLight color="#fff0a8" decay={2} distance={24} intensity={2.4} position={[-6, -3, -5]} />
          <Environment preset="night" resolution={lowPower ? 64 : 128} />
          <NoorCore mouseRef={mouseRef} lowPower={lowPower} />
          {!lowPower && (
            <EffectComposer multisampling={0} enableNormalPass={false}>
              <Bloom intensity={0.76} luminanceThreshold={0.22} luminanceSmoothing={0.36} mipmapBlur radius={0.58} />
              <Noise blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.045} premultiply />
              <Vignette eskil={false} offset={0.18} darkness={0.72} />
            </EffectComposer>
          )}
          <Preload all />
        </Suspense>
      </Canvas>
    </div>
  );
}
