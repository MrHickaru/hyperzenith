import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ParticleFieldProps {
  count: number;
  active: boolean;
}

const ParticleField = ({ count, active }: ParticleFieldProps) => {
  const points = useMemo(() => {
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 15;
      p[i * 3 + 1] = (Math.random() - 0.5) * 15;
      p[i * 3 + 2] = (Math.random() - 0.5) * 15;
    }
    return p;
  }, [count]);

  const pointsRef = useRef<THREE.Points>(null!);
  const frameCount = useRef(0);

  useEffect(() => {
    return () => {
      if (pointsRef.current) pointsRef.current.geometry.dispose();
    };
  }, []);

  useFrame(() => {
    if (!pointsRef.current) return;
    frameCount.current++;
    // Throttle when not active
    if (!active && frameCount.current % 3 !== 0) return;
    pointsRef.current.rotation.y += active ? 0.005 : 0.001;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={active ? "#ff0055" : "#00f3ff"}
        transparent
        opacity={active ? 0.6 : 0.2}
        size={active ? 0.05 : 0.02}
        sizeAttenuation
      />
    </points>
  );
};

interface PistonProps {
  offset: number;
  speed: number;
  intensity: number;
  geometry: THREE.CylinderGeometry;
}

const Piston = ({ offset, speed, intensity, geometry }: PistonProps) => {
  const mesh = useRef<THREE.Mesh>(null!);
  const frameCount = useRef(0);

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: intensity > 0.3 ? "#ff0055" : "#00f3ff",
    emissive: intensity > 0.3 ? "#ff0055" : "#00f3ff",
    emissiveIntensity: intensity > 0.3 ? 1.5 : 0.3,
    roughness: 0.3,
    metalness: 0.7,
    wireframe: intensity < 0.1 // Wireframe when idle for that high-tech look
  }), [intensity]);

  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  useFrame((state) => {
    if (!mesh.current) return;
    frameCount.current++;
    // Throttle logic
    if (intensity < 0.1 && frameCount.current % 2 !== 0) return;

    const time = state.clock.getElapsedTime();
    mesh.current.position.y = Math.sin((time * speed) + offset) * 1.0;
    mesh.current.rotation.y += 0.003 + intensity * 0.01;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} />;
};

interface EngineProps {
  rpm: number;
  turboActive: boolean;
  vramUsage: string;
  isBuilding?: boolean;
  ecoMode?: boolean;
}

export const GpuEngine: React.FC<EngineProps> = React.memo(({ rpm, turboActive, vramUsage, isBuilding, ecoMode }) => {
  const active = !!isBuilding;

  // ULTRA RESOURCE OPTIMIZATION: RadialSegments=8 (Low Poly) for massive VRAM savings
  const pistonGeometry = useMemo(() => new THREE.CylinderGeometry(0.4, 0.4, 1.5, 8, 2), []);

  useEffect(() => {
    return () => pistonGeometry.dispose();
  }, [pistonGeometry]);

  return (
    <div className={`relative h-64 w-full bg-black rounded-lg border transition-all duration-500 overflow-hidden 
      ${active ? 'border-[#ff0055] shadow-[0_0_30px_rgba(255,0,85,0.4)]' : 'border-[#00f3ff]/30'}`}>
      <Canvas
        camera={{ position: [0, 2, 10], fov: 45 }}
        frameloop={ecoMode ? "demand" : "always"}
        dpr={ecoMode ? 1 : [1, 2]}
        gl={{
          powerPreference: "high-performance", // Use the 3070ti for the visual juice
          antialias: !ecoMode,
          alpha: false,
          stencil: false,
          depth: true
        }}
      >
        <ambientLight intensity={ecoMode ? 0.2 : 0.4} />
        <pointLight position={[10, 10, 10]} intensity={active ? 2 : 0.8} color={active ? "#ff0055" : "#00f3ff"} />

        <ParticleField count={active ? 300 : 50} active={active} />

        {Array.from({ length: 8 }).map((_, i) => (
          <group position={[(i - 3.5) * 1.3, 0, 0]} key={i}>
            <Piston
              offset={i * 0.5}
              speed={active ? 5 : (turboActive ? rpm * 0.2 : rpm * 0.1)}
              intensity={active ? 0.8 : 0}
              geometry={pistonGeometry}
            />
          </group>
        ))}
      </Canvas>
      <div className="absolute top-2 right-2 text-cyan-500 font-mono text-[10px] tracking-widest uppercase bg-black/70 px-2 py-1 border border-cyan-500/20">
        {ecoMode ? '🌿 ECO_LOCK' : `VRAM: ${vramUsage}`}
      </div>
      <div className="absolute bottom-2 left-2 text-[8px] text-cyan-500/40 font-mono uppercase tracking-[0.15em]">
        RTX 3070 TI // CORE_ACCELERATION: {active ? 'MAX' : 'OPTIMAL'}
      </div>
    </div>
  );
});
