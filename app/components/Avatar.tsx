"use client"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls, useGLTF, useAnimations } from "@react-three/drei"
import { useEffect, useRef } from "react"
import { audioState } from "../lib/audioState"
import * as THREE from "three"

// Priority order: viseme_D (new viseme-rigged models) → Mouth_Open (legacy single-key models).
// First match wins. Future: replace this single-key approach with phoneme-driven viseme switching.
const MOUTH_KEY_PRIORITY = ["viseme_D", "Mouth_Open"]

function findMouthKey(dict: Record<string, number> | undefined): string | null {
  if (!dict) return null
  for (const name of MOUTH_KEY_PRIORITY) {
    if (dict[name] !== undefined) return name
  }
  return null
}

function Model({ modelPath }: { modelPath: string }) {
  const { scene, animations } = useGLTF(modelPath)
  const { actions } = useAnimations(animations, scene)
  const mouthMeshes = useRef<{ mesh: any; keyName: string }[]>([])

  useEffect(() => {
    mouthMeshes.current = []

    // Add black backface clone only for the face mesh (has mouth morph targets).
    // Cloning ALL meshes doubles the polygon count and kills CPU.
    scene.traverse((child: any) => {
      if (!child.isMesh) return
      const keyName = findMouthKey(child.morphTargetDictionary)
      if (keyName === null) return

      const backMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.BackSide,
      })
      const backMesh = child.clone()
      backMesh.material = backMat
      child.parent?.add(backMesh)
    })

    // Play idle animation
    if (actions && Object.keys(actions).length > 0) {
      const idle = actions["idle"] || actions[Object.keys(actions)[0]]
      idle?.play()
    }

    // Find mouth morph targets — track which key name to drive on each mesh
    scene.traverse((child: any) => {
      const keyName = findMouthKey(child.morphTargetDictionary)
      if (keyName !== null) {
        mouthMeshes.current.push({ mesh: child, keyName })
      }
    })
  }, [actions, scene])

  const { invalidate } = useThree()

  // Drive demand-mode rendering at ~30fps when there's a reason to render.
  // Using setInterval instead of useFrame's invalidate so we throttle the
  // render rate independently of the animation/audio update rate.
  // ~33ms target interval = ~30fps. Cuts CPU roughly in half vs 60fps,
  // and the eye can't tell the difference for facial animation.
  useEffect(() => {
    const id = setInterval(() => {
      const hasActiveAnimation = actions && Object.values(actions).some((a: any) => a?.isRunning())
      if (audioState.volume > 0 || hasActiveAnimation) {
        invalidate()
      }
    }, 33)
    return () => clearInterval(id)
  }, [invalidate, actions])

  useFrame(() => {
    // Update morph targets on every render frame (the render rate itself is
    // throttled to ~30fps by the setInterval above, so this fires at ~30fps too).
    for (const { mesh, keyName } of mouthMeshes.current) {
      const index = mesh.morphTargetDictionary[keyName]
      mesh.morphTargetInfluences[index] = audioState.volume
    }
  })

  return <primitive object={scene} position={[0, -1, 0]} />
}

export default function Avatar({ modelPath = "/Aimee.glb" }: { modelPath?: string }) {
  return (
    <Canvas
      camera={{ position: [0, 1, 3], fov: 50 }}
      dpr={[1, 1]}
      frameloop="demand"
      gl={{ antialias: false, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Model modelPath={modelPath} />
      <OrbitControls />
    </Canvas>
  )
}
