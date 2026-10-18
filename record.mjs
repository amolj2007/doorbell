// Records the Ring doorbell's live stream to disk on motion / doorbell press.
// Ring keeps no video without a Ring Protect plan, so this captures live view
// instead. Expect the first 2-4s of each event to be missed while the stream starts.
import { RingApi } from 'ring-client-api'
import { readFileSync, writeFileSync, mkdirSync, existsSync, constants as fsc } from 'fs'
import { access, copyFile, mkdir, rm } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(HERE, '.token')
// Local clips folder: every clip is recorded here first, and stays here
// whenever the NAS can't take it
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'clips')
// Network share root; clips move to NAS_DIR/<camera>/ (e.g. frontdoor, patio). Empty = local only
const NAS_DIR = process.env.NAS_DIR || ''
const NAS_TIMEOUT_MS = 10_000
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

// "Front Door" -> "frontdoor"
const folderFor = (camera) => camera.name.toLowerCase().replace(/[^a-z0-9]+/g, '')

function withTimeout(promise, ms, what) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// Move a finished clip to the NAS. On any failure the clip stays in the local folder.
async function moveToNas(camera, localFile) {
  if (!NAS_DIR) return
  const destDir = path.join(NAS_DIR, folderFor(camera))
  const dest = path.join(destDir, path.basename(localFile))
  try {
    // The NAS root must already exist (it is the mounted share); never create it
    // locally, or clips would silently pile up on the Optiplex's own disk
    await withTimeout(access(NAS_DIR, fsc.W_OK), NAS_TIMEOUT_MS, 'NAS check')
    await mkdir(destDir, { recursive: true })
    await withTimeout(copyFile(localFile, dest), 120_000, 'NAS copy')
    await rm(localFile)
    log(`[${camera.name}] moved to ${dest}`)
  } catch (e) {
    log(`[${camera.name}] NAS unavailable (${e?.code || e?.message || e}); kept ${localFile}`)
    await rm(dest, { force: true }).catch(() => {})
  }
}

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
  }
  if (recorded) await moveToNas(camera, file)
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

const shutdown = () => {
  log('shutting down')
  ringApi.disconnect()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
