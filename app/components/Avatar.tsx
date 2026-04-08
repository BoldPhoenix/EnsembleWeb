"use client"                                                                                                                                                
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, useGLTF, useAnimations } from "@react-three/drei"
import { useEffect, useRef } from "react"
import { audioState } from "../lib/audioState"

function Model() {
    const { scene, animations } = useGLTF("/Aimee.glb")
    const { actions } = useAnimations(animations, scene)
    const mouthMeshes = useRef<any[]>([])

    useEffect(() => {
      if (actions && Object.keys(actions).length > 0) {
        const idle = actions["idle"] || actions[Object.keys(actions)[0]]
        idle?.play()
      }

      scene.traverse((child: any) => {
    if (child.morphTargetDictionary && child.morphTargetDictionary["Mouth_Open"] !== undefined) {
      mouthMeshes.current.push(child)
    }
  })
    }, [actions, scene])

    useFrame(() => {
    for (const mesh of mouthMeshes.current) {
      const index = mesh.morphTargetDictionary["Mouth_Open"]
      mesh.morphTargetInfluences[index] = audioState.volume
    }
  })
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