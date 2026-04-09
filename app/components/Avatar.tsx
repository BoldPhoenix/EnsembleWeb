"use client"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, useGLTF, useAnimations } from "@react-three/drei"
import { useEffect, useRef } from "react"
import { audioState } from "../lib/audioState"
import * as THREE from "three"

function Model({ modelPath }: { modelPath: string }) {
  const { scene, animations } = useGLTF(modelPath)
  const { actions } = useAnimations(animations, scene)
  const mouthMeshes = useRef<any[]>([])

  useEffect(() => {
    mouthMeshes.current = []

    // Add black backface clone only for the face mesh (has morph targets)
    // Cloning ALL meshes doubles the polygon count and kills CPU
    scene.traverse((child: any) => {
      if (child.isMesh && child.morphTargetDictionary && child.morphTargetDictionary["Mouth_Open"] !== undefined) {
        const backMat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          side: THREE.BackSide,
        })
        const backMesh = child.clone()
        backMesh.material = backMat
        child.parent?.add(backMesh)
      }
    })

    // Play idle animation
    if (actions && Object.keys(actions).length > 0) {
      const idle = actions["idle"] || actions[Object.keys(actions)[0]]
      idle?.play()
    }

    // Find mouth morph targets
    scene.traverse((child: any) => {
      if (child.morphTargetDictionary && child.morphTargetDictionary["Mouth_Open"] !== undefined) {
        mouthMeshes.current.push(child)
      }
    })
  }, [actions, scene])

  const lastUpdate = useRef(0)
  useFrame(({ clock }) => {
    // Throttle to ~30fps
    const now = clock.getElapsedTime()
    if (now - lastUpdate.current < 0.033) return
    lastUpdate.current = now

    for (const mesh of mouthMeshes.current) {
      const index = mesh.morphTargetDictionary["Mouth_Open"]
      mesh.morphTargetInfluences[index] = audioState.volume
    }
  })

  return <primitive object={scene} position={[0, -1, 0]} />
}

export default function Avatar({ modelPath = "/Aimee.glb" }: { modelPath?: string }) {
  return (
    <Canvas camera={{ position: [0, 1, 3], fov: 50 }} dpr={[1, 1.5]}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Model modelPath={modelPath} />
      <OrbitControls />
    </Canvas>
  )
}
