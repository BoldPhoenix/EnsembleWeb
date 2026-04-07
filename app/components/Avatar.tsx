"use client"                                                                                                                                                
  import { Canvas } from "@react-three/fiber"
  import { OrbitControls, useGLTF, useAnimations } from "@react-three/drei"
  import { useEffect } from "react"

  function Model() {
    const { scene, animations } = useGLTF("/Aimee2.glb")                                                                                                           
    const { actions } = useAnimations(animations, scene)
    
    useEffect(() => {
      if (actions && Object.keys(actions).length > 0) {
        const idle = actions["idle"] || actions[Object.keys(actions)[0]]
        idle?.play()
      }
    }, [actions])

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