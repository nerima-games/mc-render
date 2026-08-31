/**
 * Compile mc-render's three generated shaders on a real GL driver.
 *
 * Lowered from mc-compose's `apps/shader-probe`. The only
 * change from the compose original is the import below: it now reads
 * `../../src/index.js`, this package's own source, rather than
 * `@nerima-games/mc-render` — the app lives beside the code it draws now,
 * instead of consuming it through the published package graph.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * `domain/chunk-shader.ts`, `domain/water-shader.ts` and
 * `domain/particle-shader.ts` each generate GLSL from constants, and each is
 * covered by a Node suite that asserts things about the STRING — that the
 * coefficients are interpolated, that no bare integer sits in an arithmetic
 * position, that the declared uniforms match the domain's list. Every one of
 * those headers then says the same thing: none of it compiles GLSL, because
 * there is no GL context in Node, and mc-compose's Playwright run is where the
 * source is actually compiled.
 *
 * That sentence named a check that did not exist. This page is the check.
 *
 * ---------------------------------------------------------------------------
 * WHY IT GOES THROUGH `ShaderMaterial` AND NOT `gl.compileShader`
 * ---------------------------------------------------------------------------
 *
 * Handing the raw source to `gl.compileShader` would FAIL, and would fail for a
 * reason that says nothing about mc-render: three.js prepends a preamble
 * declaring `position`, `normal`, `uv`, `color`, `projectionMatrix`,
 * `modelViewMatrix`, `modelMatrix`, `viewMatrix` and `normalMatrix`, and the
 * generated sources use those without declaring them — correctly, because
 * they are written to be three's.
 *
 * So the probe builds the real materials through mc-render's own factories and
 * asks three to compile them. That also means a passing run proves slightly
 * more than "the GLSL is valid": it proves the ATTRIBUTE and UNIFORM names the
 * geometry binds are the ones the linked program actually wants.
 *
 * ---------------------------------------------------------------------------
 * HOW A FAILURE IS DETECTED
 * ---------------------------------------------------------------------------
 *
 * three does not throw on a shader error. With
 * `renderer.debug.checkShaderErrors` (default true) it logs the driver's error
 * text through `console.error` and carries on with a broken program — which is
 * exactly why a shader defect reaches a browser as a blank canvas rather than
 * as an exception, and why this had to be checked somewhere.
 *
 * `console.error` is therefore intercepted for the duration of the compile and
 * anything it receives is a failure. The report is written to the DOM so that
 * Playwright reads a value rather than scraping a log, and so that a human
 * opening the page sees the same thing the test does.
 */
import * as THREE from 'three'
import { Effect } from 'effect'
import {
  buildChunkGeometry,
  makeChunkShaderMaterial,
  makeParticlePool,
  makeParticleSystem,
  makeWaterMaterial,
  makeWorldRenderer,
  spawnBurst,
  type MeshQuad,
  type MirroredCameraState,
} from '../../src/index.js'

const VIEWPORT = { width: 320, height: 180 }

/** One visible face, so the chunk geometry is not empty. */
const QUAD: MeshQuad = {
  blockId: 1,
  direction: 'yPos',
  role: 'top',
  lx: 0,
  y: 0,
  lz: 0,
  width: 2,
  height: 2,
  ao: 0,
}

/**
 * A pose to draw from. CAST, once, and the cast is the honest option here.
 *
 * `MirroredCameraState.position` is kernel's branded `Position` and
 * `sourceCapturedAtSecs` is its branded `MonotonicTimeSecs`. mc-render
 * deliberately does NOT re-export kernel's vocabulary — `index.ts` says so and
 * says why: consumers take it from the published `@nerima-games/mc-kernel`
 * package. Local sibling resolution remains an optional Vite overlay, not the
 * package boundary.
 *
 * The alternative to the cast would be reconstructing the chunk material and
 * its attribute binding by hand in this file, which would test a
 * reconstruction rather than `makeWorldRenderer`. A brand carries no runtime
 * representation and the renderer only reads six numbers off this, so the cast
 * is inert — and the thing being probed is the shader, not the pose.
 */
const PROBE_CAMERA = {
  position: { x: 0, y: 8, z: 8 },
  rotation: { x: 0, y: 0, z: 0, order: 'YXZ' },
  sourceCapturedAtSecs: 0,
} as unknown as MirroredCameraState

type ProbeResult = {
  readonly name: string
  readonly compiled: boolean
  readonly errors: ReadonlyArray<string>
}

/**
 * Run `compile` with `console.error` intercepted.
 *
 * Restored in a `finally`, because a probe that swallowed console.error
 * permanently would make every later failure on the page invisible — including
 * the ones this file is not looking for.
 */
const captureErrors = async (compile: () => Promise<void> | void): Promise<ReadonlyArray<string>> => {
  const captured: Array<string> = []
  const original = console.error
  console.error = (...args: ReadonlyArray<unknown>): void => {
    captured.push(args.map((arg) => String(arg)).join(' '))
    original(...args)
  }
  try {
    await compile()
  } finally {
    console.error = original
  }
  return captured
}

const probeChunkShader = async (canvas: HTMLCanvasElement): Promise<ProbeResult> => {
  const errors = await captureErrors(async () => {
    // THE REAL PATH, not a reconstruction of it: `makeWorldRenderer` with a
    // material factory is exactly what a textured host does, and `setChunk`
    // is what binds the `tileIndex` attribute the vertex stage declares.
    const renderer = await Effect.runPromise(
      makeWorldRenderer<
        HTMLCanvasElement,
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial,
        THREE.ShaderMaterial
      >(THREE, canvas, VIEWPORT, {
        material: () =>
          makeChunkShaderMaterial<
            HTMLCanvasElement,
            THREE.BufferGeometry,
            THREE.MeshBasicMaterial,
            THREE.ShaderMaterial
          >(THREE, new THREE.Texture()).material,
      }),
    )
    await Effect.runPromise(renderer.setChunk('0,0', buildChunkGeometry([QUAD], 0, 0)))
    // Drawing is what forces the program to link. `compile()` would do for a
    // scene this file owned, but the scene here is the renderer's.
    await Effect.runPromise(renderer.draw(PROBE_CAMERA))
    await Effect.runPromise(renderer.dispose)
  })
  return { name: 'chunk', compiled: errors.length === 0, errors }
}

const probeWaterShader = async (canvas: HTMLCanvasElement): Promise<ProbeResult> => {
  const errors = await captureErrors(() => {
    const renderer = new THREE.WebGLRenderer({ canvas })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300)

    const { material } = makeWaterMaterial<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.ShaderMaterial
    >(THREE, VIEWPORT)

    // A plane with the attributes the water vertex stage reads. `color` is
    // present because the material is built with `vertexColors: true`, which
    // makes three declare the attribute whether or not this shader samples it.
    const geometry = new THREE.PlaneGeometry(4, 4)
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(geometry.attributes['position']!.count * 3), 3),
    )
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    renderer.render(scene, camera)

    geometry.dispose()
    material.dispose()
    renderer.dispose()
  })
  return { name: 'water', compiled: errors.length === 0, errors }
}

const probeParticleShader = async (canvas: HTMLCanvasElement): Promise<ProbeResult> => {
  const errors = await captureErrors(async () => {
    const renderer = new THREE.WebGLRenderer({ canvas })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300)

    const pool = makeParticlePool({ capacity: 16 })
    // A live particle, so `instanceCount` is non-zero and the instanced
    // attributes are actually consumed by a draw.
    spawnBurst(pool, 0, 0, -4, 0, 0, 4)

    const system = await Effect.runPromise(
      makeParticleSystem<
        HTMLCanvasElement,
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial,
        THREE.InstancedBufferGeometry,
        THREE.ShaderMaterial
      >(THREE, pool, new THREE.Texture()),
    )
    await Effect.runPromise(system.sync)

    scene.add(system.mesh as unknown as THREE.Object3D)
    renderer.render(scene, camera)

    await Effect.runPromise(system.dispose)
    renderer.dispose()
  })
  return { name: 'particle', compiled: errors.length === 0, errors }
}

const main = async (): Promise<void> => {
  const canvas = document.getElementById('probe-canvas')
  const report = document.getElementById('probe-report')
  if (!(canvas instanceof HTMLCanvasElement) || report === null) {
    document.body.setAttribute('data-shader-probe', 'failed')
    return
  }
  canvas.width = VIEWPORT.width
  canvas.height = VIEWPORT.height

  const results: Array<ProbeResult> = []
  try {
    // Each probe gets its OWN canvas. A WebGL context is bound to a canvas for
    // its lifetime, and three refuses to build a second renderer on one that
    // already has a context — which would make probes 2 and 3 report a
    // context-creation failure and look like shader failures.
    results.push(await probeChunkShader(canvas))
    results.push(await probeWaterShader(document.createElement('canvas')))
    results.push(await probeParticleShader(document.createElement('canvas')))
  } catch (thrown) {
    results.push({ name: 'probe', compiled: false, errors: [String(thrown)] })
  }

  const failed = results.filter((result) => !result.compiled)

  report.textContent = results
    .map((result) =>
      result.compiled
        ? `OK    ${result.name}`
        : `FAIL  ${result.name}\n${result.errors.join('\n')}`,
    )
    .join('\n')
  report.className = failed.length === 0 ? 'ok' : 'fail'

  document.body.setAttribute('data-shader-probe', failed.length === 0 ? 'passed' : 'failed')
  document.body.setAttribute('data-shader-probe-compiled', String(results.length - failed.length))
  document.body.setAttribute('data-shader-probe-total', String(results.length))
}

main().catch((error: unknown) => {
  console.error('shader probe failed:', error)
})
