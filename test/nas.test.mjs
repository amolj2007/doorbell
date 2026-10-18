import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, rm, utimes } from 'fs/promises'
import { existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { createNas, folderForFile } from '../nas.mjs'

const old = new Date(Date.now() - 10 * 60_000)

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'doorbell-'))
  const outDir = path.join(root, 'clips')
  const nasDir = path.join(root, 'nas', 'doorbell') // absent until the test "mounts" it
  const logs = []
  return { root, outDir, nasDir, logs, log: (m) => logs.push(m) }
}

async function clip(outDir, name, { aged = true } = {}) {
  const dir = path.join(outDir, '2026-10-18')
  await mkdir(dir, { recursive: true })
  const f = path.join(dir, name)
  await writeFile(f, 'video')
  if (aged) await utimes(f, old, old)
  return f
}

test('folderForFile maps camera names to folders', () => {
  assert.equal(folderForFile('Front_Door_motion_2026-10-18T22-49-48-312Z.mp4'), 'frontdoor')
  assert.equal(folderForFile('Patio_ding_2026-10-18T23-30-02-273Z.mp4'), 'patio')
  assert.equal(folderForFile('random.mp4'), 'other')
})

test('NAS down: clip stays local; NAS back: sweep moves it', async () => {
  const t = await setup()
  const nas = createNas({ ...t, checkTimeoutMs: 500 })
  const f = await clip(t.outDir, 'Front_Door_motion_2026-10-18T22-49-48-312Z.mp4')

  assert.equal(await nas.moveToNas(f), null)
  assert.ok(existsSync(f), 'clip kept locally while NAS is down')
  assert.equal(await nas.sweep(), 0)
  assert.ok(!existsSync(t.nasDir), 'NAS root never created locally')

  await mkdir(t.nasDir, { recursive: true }) // share comes back
  assert.equal(await nas.sweep(), 1)
  assert.ok(!existsSync(f), 'local copy removed')
  assert.deepEqual(await readdir(path.join(t.nasDir, 'frontdoor')), [path.basename(f)])
  assert.ok(t.logs.some((m) => m.startsWith('NAS back online')))
  await rm(t.root, { recursive: true, force: true })
})

test('sweep skips clips being recorded or written in the last minute', async () => {
  const t = await setup()
  await mkdir(t.nasDir, { recursive: true })
  const active = new Set()
  const nas = createNas({ ...t, active })
  const recording = await clip(t.outDir, 'Patio_motion_2026-10-18T23-00-00-000Z.mp4')
  active.add(recording)
  const fresh = await clip(t.outDir, 'Patio_ding_2026-10-18T23-01-00-000Z.mp4', { aged: false })
  const done = await clip(t.outDir, 'Front_Door_ding_2026-10-18T23-02-00-000Z.mp4')

  assert.equal(await nas.sweep(), 1)
  assert.ok(existsSync(recording) && existsSync(fresh))
  assert.ok(!existsSync(done))
  await rm(t.root, { recursive: true, force: true })
})

test('moveToNas files clips into per-camera folders', async () => {
  const t = await setup()
  await mkdir(t.nasDir, { recursive: true })
  const nas = createNas(t)
  const f = await clip(t.outDir, 'Patio_motion_2026-10-18T23-00-00-000Z.mp4', { aged: false })
  assert.equal(await nas.moveToNas(f), path.join(t.nasDir, 'patio', path.basename(f)))
  assert.ok(!existsSync(f))
  await rm(t.root, { recursive: true, force: true })
})

test('empty nasDir disables the NAS', async () => {
  const t = await setup()
  const nas = createNas({ ...t, nasDir: '' })
  const f = await clip(t.outDir, 'Patio_motion_2026-10-18T23-00-00-000Z.mp4')
  assert.equal(await nas.moveToNas(f), null)
  assert.equal(await nas.sweep(), 0)
  assert.ok(existsSync(f))
  await rm(t.root, { recursive: true, force: true })
})
