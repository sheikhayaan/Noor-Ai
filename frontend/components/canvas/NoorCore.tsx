"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SmoothMouseRef } from "@/hooks/useMouse";
import { useUiStore } from "@/store/useUiStore";

const particleVertexShader = `
  attribute float aSeed;
  attribute float aLayer;
  uniform float uTime;
  uniform float uScroll;
  uniform float uPulse;
  uniform vec2 uMouse;
  varying float vSeed;
  varying float vLayer;

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    vSeed = aSeed;
    vLayer = aLayer;

    vec3 p = position;
    float orbit = uTime * (0.18 + aSeed * 0.34) + aSeed * 6.28318;
    float explosion = smoothstep(0.28, 0.72, uScroll);
    float openCore = smoothstep(0.66, 1.0, uScroll);
    float pulse = uPulse * exp(-uPulse * 0.75);

    vec3 direction = normalize(position + vec3(0.001));
    p += direction * explosion * (1.4 + aSeed * 3.8);
    p.x += sin(orbit + p.z * 0.08) * (0.22 + aLayer * 0.85 + pulse * 0.5);
    p.y += cos(orbit * 1.35 + p.x * 0.05) * (0.18 + aSeed * 0.42);
    p.z += sin(orbit * 0.55) * openCore * 2.2;
    p.xy += uMouse * (0.5 + aLayer * 0.9);

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (2.2 + aSeed * 4.2 + pulse * 2.5) * (8.0 / -mvPosition.z);
  }
`;

const particleFragmentShader = `
  varying float vSeed;
  varying float vLayer;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float distanceToCenter = length(uv);
    float glow = smoothstep(0.5, 0.0, distanceToCenter);
    float core = smoothstep(0.16, 0.0, distanceToCenter);
    vec3 cyan = vec3(0.32, 1.0, 0.92);
    vec3 violet = vec3(0.42, 0.52, 1.0);
    vec3 gold = vec3(1.0, 0.9, 0.52);
    vec3 color = mix(cyan, violet, smoothstep(0.2, 0.8, vLayer));
    color = mix(color, gold, smoothstep(0.76, 1.0, vSeed));
    gl_FragColor = vec4(color, (glow * 0.48 + core * 0.7) * (0.45 + vLayer * 0.55));
  }
`;

const shellVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  uniform float uScroll;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    float wave = sin(position.y * 9.0 + uTime * 1.8) * 0.05;
    vec3 p = position + normal * (wave + uScroll * 0.11);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const shellFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  uniform float uScroll;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453);
  }

  void main() {
    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.25);
    float bands = sin((vPosition.y + vPosition.x * 0.28) * 12.0 + uTime * 2.2) * 0.5 + 0.5;
    float grain = hash(vPosition * 3.0 + uTime * 0.1);
    vec3 color = mix(vec3(0.04, 0.5, 0.58), vec3(0.95, 1.0, 0.84), fresnel + bands * 0.18);
    float alpha = 0.18 + fresnel * 0.52 + bands * 0.08 + grain * 0.04 + uScroll * 0.12;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function NoorCore({ mouseRef, lowPower }: { mouseRef: SmoothMouseRef; lowPower?: boolean }) {
  const groupRef = useRef<THREE.Group | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const nodesRef = useRef<THREE.InstancedMesh | null>(null);
  const ringsRef = useRef<THREE.Group | null>(null);
  const { camera } = useThree();
  const playgroundPulse = useUiStore((state) => state.playgroundPulse);
  const pulseRef = useRef(0);

  useEffect(() => {
    pulseRef.current = 1.6;
  }, [playgroundPulse]);

  const particleGeometry = useMemo(() => {
    const count = lowPower ? 2800 : 6400;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const layers = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      const seed = Math.random();
      const layer = Math.random();
      const radius = 1.2 + Math.pow(Math.random(), 0.46) * 3.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
      positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius;
      positions[index * 3 + 2] = Math.cos(phi) * radius;
      seeds[index] = seed;
      layers[index] = layer;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute("aLayer", new THREE.BufferAttribute(layers, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }, [lowPower]);

  const particleMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPulse: { value: 0 },
      uMouse: { value: new THREE.Vector2() },
    },
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  const shellMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
    },
    vertexShader: shellVertexShader,
    fragmentShader: shellFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  const nodeMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#fff0a8",
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#67ffeb",
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  useEffect(() => {
    if (!nodesRef.current) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (let index = 0; index < 180; index += 1) {
      const angle = index * 2.399963;
      const radius = 4.8 + Math.sin(index * 0.67) * 1.1;
      position.set(Math.cos(angle) * radius, THREE.MathUtils.randFloatSpread(5.4), Math.sin(angle) * radius);
      scale.setScalar(0.035 + (index % 7) * 0.006);
      matrix.compose(position, quaternion, scale);
      nodesRef.current.setMatrixAt(index, matrix);
    }
    nodesRef.current.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    const { scrollProgress } = useUiStore.getState();
    const mouse = mouseRef.current;
    pulseRef.current = THREE.MathUtils.damp(pulseRef.current, 0, 2.2, delta);

    particleMaterial.uniforms.uTime.value += delta;
    particleMaterial.uniforms.uScroll.value = THREE.MathUtils.damp(particleMaterial.uniforms.uScroll.value, scrollProgress, 3, delta);
    particleMaterial.uniforms.uPulse.value = pulseRef.current;
    particleMaterial.uniforms.uMouse.value.set(mouse.x, -mouse.y);
    shellMaterial.uniforms.uTime.value += delta;
    shellMaterial.uniforms.uScroll.value = particleMaterial.uniforms.uScroll.value;

    camera.position.x = THREE.MathUtils.damp(camera.position.x, mouse.x * 2.2, 3.4, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.3 - mouse.y * 1.4 - scrollProgress * 2.1, 3.4, delta);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, 10.8 - scrollProgress * 5.1, 2.4, delta);
    camera.lookAt(mouse.x * 0.8, -mouse.y * 0.45, -2.4 - scrollProgress * 4.2);

    if (groupRef.current) {
      groupRef.current.rotation.y += delta * (0.11 + scrollProgress * 0.18);
      groupRef.current.rotation.x = THREE.MathUtils.damp(groupRef.current.rotation.x, mouse.y * 0.32, 3, delta);
      groupRef.current.rotation.z = THREE.MathUtils.damp(groupRef.current.rotation.z, -mouse.x * 0.28, 3, delta);
      groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, 1 + scrollProgress * 0.72 + pulseRef.current * 0.08, 2.6, delta));
    }

    if (ringsRef.current) {
      ringsRef.current.children.forEach((ring, index) => {
        ring.rotation.x += delta * (0.12 + index * 0.025);
        ring.rotation.z -= delta * (0.09 + index * 0.02);
      });
    }

    if (nodesRef.current) {
      nodesRef.current.rotation.y -= delta * 0.04;
      nodesRef.current.visible = scrollProgress > 0.16;
      nodeMaterial.opacity = THREE.MathUtils.damp(nodeMaterial.opacity, 0.18 + scrollProgress * 0.58, 2.4, delta);
    }
  });

  return (
    <Float speed={1.05} floatIntensity={0.28} rotationIntensity={0.12}>
      <group ref={groupRef} position={[1.55, 0.05, -3.15]}>
        <points ref={pointsRef} geometry={particleGeometry} material={particleMaterial} frustumCulled={false} />
        <mesh material={shellMaterial}>
          <icosahedronGeometry args={[2.45, 7]} />
        </mesh>
        <group ref={ringsRef}>
          {[0, 1, 2, 3, 4].map((ring) => (
            <mesh key={ring} material={ringMaterial} rotation={[ring * 0.48, ring * 0.33, ring * 0.62]}>
              <torusGeometry args={[3 + ring * 0.36, 0.012, 8, 180]} />
            </mesh>
          ))}
        </group>
        <instancedMesh ref={nodesRef} args={[undefined, undefined, 180]} material={nodeMaterial}>
          <sphereGeometry args={[1, 10, 10]} />
        </instancedMesh>
      </group>
    </Float>
  );
}
