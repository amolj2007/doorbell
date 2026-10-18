// Moves finished clips from the local clips folder to the NAS share, and sweeps
// up clips left behind while the share was unavailable.
import { constants as fsc } from 'fs'
import { access, copyFile, mkdir, readdir, rm, stat } from 'fs/promises'
import path from 'path'

// "Front Door" -> "frontdoor"
export const folderForName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

// Clip names are <Camera_Name>_<reason>_<ISO timestamp>.mp4 (see record.mjs)
export function folderForFile(file) {
  const m = path.basename(file).match(/^(.+?)_(motion|ding)_\d{4}-\d{2}-\d{2}T/)
  return m ? folderForName(m[1]) || 'other' : 'other'
}

function withTimeout(promise, ms, what) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function listClips(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listClips(p)))
    else if (entry.isFile() && entry.name.endsWith('.mp4')) out.push(p)
  }
  return out
}

/**
 * nasDir: share root (e.g. /mnt/nas/doorbell); '' disables the NAS entirely.
 * active: Set of local paths still being recorded, which the sweep must not touch.
 */
export function createNas({ nasDir, outDir, log, active = new Set(),
  checkTimeoutMs = 10_000, copyTimeoutMs = 120_000, minAgeMs = 60_000 }) {
  let up = null // last known state, so the sweep logs changes rather than every run
  let sweeping = false

  async function available() {
    if (!nasDir) return false
    try {
      // The NAS root must already exist (it is the mounted share); never create it
      // locally, or clips would silently pile up on the Optiplex's own disk
      await withTimeout(access(nasDir, fsc.W_OK), checkTimeoutMs, 'NAS check')
      if (up === false) log(`NAS back online: ${nasDir}`)
      up = true
    } catch (e) {
      if (up !== false) log(`NAS unavailable (${e?.code || e?.message || e}); clips stay in ${outDir}`)
      up = false
    }
    return up
  }

  // Copy then delete; on any failure the clip stays local and the partial copy is removed
  async function move(localFile) {
    const destDir = path.join(nasDir, folderForFile(localFile))
    const dest = path.join(destDir, path.basename(localFile))
    try {
      await mkdir(destDir, { recursive: true })
      await withTimeout(copyFile(localFile, dest), copyTimeoutMs, 'NAS copy')
      await rm(localFile)
      return dest
    } catch (e) {
      log(`NAS copy failed for ${localFile} (${e?.code || e?.message || e}); kept locally`)
      await rm(dest, { force: true }).catch(() => {})
      return null
    }
  }

  async function moveToNas(localFile) {
    if (!nasDir) return null
    if (!(await available())) {
      log(`kept ${localFile}; will move it when the NAS is back`)
      return null
    }
    const dest = await move(localFile)
    if (dest) log(`moved to ${dest}`)
    return dest
  }

  // Move every finished clip still in outDir. Returns how many were moved.
  async function sweep() {
    if (!nasDir || sweeping) return 0
    sweeping = true
    try {
      const now = Date.now()
      const pending = []
      for (const f of await listClips(outDir)) {
        if (active.has(f)) continue
        // Skip files written in the last minute: a recording or move may still own them
        const s = await stat(f).catch(() => null)
        if (s && now - s.mtimeMs >= minAgeMs) pending.push(f)
      }
      if (pending.length === 0 || !(await available())) return 0
      let moved = 0
      for (const f of pending) {
        if (await move(f)) moved++
        else break // the share likely dropped mid-sweep; retry on the next run
      }
      if (moved) log(`sweep: moved ${moved} of ${pending.length} leftover clip(s) to ${nasDir}`)
      return moved
    } finally {
      sweeping = false
    }
  }

  return { moveToNas, sweep, available }
}
