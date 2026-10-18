// Records the Ring doorbell's live stream to disk on motion / doorbell press.
// Ring keeps no video without a Ring Protect plan, so this captures live view
// instead. Expect the first 2-4s of each event to be missed while the stream starts.
import { RingApi } from 'ring-client-api'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(HERE, '.token')
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'clips')
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
})

// Ring rotates the refresh token; persist the new one or auth breaks on next restart
ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
  writeFileSync(TOKEN_FILE, newRefreshToken, { mode: 0o600 })
  log('refresh token updated')
})

const busy = new Set()

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
  try {
    log(`[${camera.name}] ${reason} -> ${file}`)
    await camera.recordToFile(file, CLIP_SECONDS)
    log(`[${camera.name}] saved ${file}`)
  } catch (e) {
    log(`[${camera.name}] record failed: ${e?.message || e}`)
  } finally {
    busy.delete(camera.id)
  }
}

const cameras = await ringApi.getCameras()
if (cameras.length === 0) {
  console.error('No Ring cameras/doorbells found on this account.')
  process.exit(1)
}

for (const camera of cameras) {
  log(`watching ${camera.name} (battery ${camera.batteryLevel ?? '?'}%)`)
  if (RECORD_MOTION) {
    camera.onMotionDetected.subscribe((motion) => motion && record(camera, 'motion'))
  }
  if (RECORD_DING) {
    camera.onDoorbellPressed.subscribe(() => record(camera, 'ding'))
  }
}

const shutdown = () => {
  log('shutting down')
  ringApi.disconnect()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
