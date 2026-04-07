"use client"                                                                                                                                                
  import { Canvas } from "@react-three/fiber"                                                                                                                   
  import { OrbitControls, useGLTF } from "@react-three/drei"

  function Model() {
    const { scene } = useGLTF("/aimee.glb")
    return <primitive object={scene} position={[0, -1, 0]} />
  }

  export default function Avatar() {
    return (
      <Canvas camera={{ position: [0, 1, 3], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <Model />
        <OrbitControls />
      </Canvas>
    )
  }