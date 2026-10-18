// Records the Ring doorbell's live stream to disk on motion / doorbell press.
// Ring keeps no video without a Ring Protect plan, so this captures live view
// instead. Expect the first 2-4s of each event to be missed while the stream starts.
import { RingApi } from 'ring-client-api'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createNas } from './nas.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(HERE, '.token')
// Local clips folder: every clip is recorded here first, and stays here
// whenever the NAS can't take it
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'clips')
// Network share root; clips move to NAS_DIR/<camera>/ (e.g. frontdoor, patio). Empty = local only
const NAS_DIR = process.env.NAS_DIR || ''
// How often clips left locally (NAS was down) are retried
const SWEEP_MINUTES = Number(process.env.SWEEP_MINUTES || 5)
const CLIP_SECONDS = Number(process.env.CLIP_SECONDS || 30)
const RECORD_MOTION = process.env.RECORD_MOTION !== '0'
const RECORD_DING = process.env.RECORD_DING !== '0'

const log = (...a) => console.log(new Date().toISOString(), ...a)

if (!existsSync(TOKEN_FILE)) {
  console.error(`No refresh token at ${TOKEN_FILE}. Run ./auth.sh first.`)
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })

const ringApi = new RingApi({
  refreshToken: readFileSync(TOKEN_FILE, 'utf8').trim(),
  // Motion/ding events arrive as push notifications; no polling needed
  cameraStatusPollingSeconds: 120,
  // Library debug logging shows push notifications it can't route
  // (also enabled by a .debug file, which needs no sudo unlike /etc/doorbell.env)
  debug: process.env.DEBUG === '1' || existsSync(path.join(HERE, '.debug')),
})

// Ring rotates the refresh token; persist the new one or auth breaks on next restart
ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
  writeFileSync(TOKEN_FILE, newRefreshToken, { mode: 0o600 })
  log('refresh token updated')
})

const busy = new Set()
// Local files still being recorded; the sweep leaves these alone
const recording = new Set()
const nas = createNas({ nasDir: NAS_DIR, outDir: OUT_DIR, log, active: recording })

async function record(camera, reason) {
  if (busy.has(camera.id)) {
    log(`[${camera.name}] ${reason} ignored, already recording`)
    return
  }
  busy.add(camera.id)
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const day = ts.slice(0, 10)
  const dir = path.join(OUT_DIR, day)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${camera.name.replace(/\W+/g, '_')}_${reason}_${ts}.mp4`)
  let recorded = false
  recording.add(file)
  try {
    log(`[${camera.name}] ${reason} -> ${file}`)
    await camera.recordToFile(file, CLIP_SECONDS)
    log(`[${camera.name}] saved ${file}`)
    recorded = true
  } catch (e) {
    log(`[${camera.name}] record failed: ${e?.message || e}`)
  } finally {
    // Free the camera before the copy so a slow NAS never blocks the next event
    busy.delete(camera.id)
    recording.delete(file)
  }
  if (recorded) await nas.moveToNas(file)
}

const cameras = await ringApi.getCameras()
if (cameras.length === 0) {
  console.error('No Ring cameras/doorbells found on this account.')
  process.exit(1)
}

for (const camera of cameras) {
  log(`watching ${camera.name} (battery ${camera.batteryLevel ?? '?'}%)`)
  camera.onNewNotification.subscribe((n) => {
    log(`[${camera.name}] push: ${n?.android_config?.category ?? 'unknown'}`)
  })
  if (RECORD_MOTION) {
    camera.onMotionDetected.subscribe((motion) => motion && record(camera, 'motion'))
  }
  if (RECORD_DING) {
    camera.onDoorbellPressed.subscribe(() => record(camera, 'ding'))
  }
}

if (NAS_DIR) {
  log(`clips move to ${NAS_DIR}; leftovers retried every ${SWEEP_MINUTES} min`)
  const runSweep = () => nas.sweep().catch((e) => log(`sweep failed: ${e?.message || e}`))
  setTimeout(runSweep, 30_000)
  setInterval(runSweep, SWEEP_MINUTES * 60_000)
}

const shutdown = () => {
  log('shutting down')
  ringApi.disconnect()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
