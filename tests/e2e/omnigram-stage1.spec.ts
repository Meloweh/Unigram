import { expect, test } from '@playwright/test'

/**
 * Stage 1 functional gate. We deliberately do NOT enforce an FPS floor here:
 * headless chromium runs without GPU acceleration and routinely measures
 * 15–25 FPS even for trivial scenes — the FPS contract is validated manually
 * on a real browser per [README.md#benchmarks].
 *
 * What we DO guard:
 *   - Spawn 2000 actually loads 2000 nodes into the renderer's model.
 *   - The cull pipeline produces a non-zero visible count smaller than total.
 *   - Pan keeps the renderer alive (FPS stays > 0 and total stays 2000).
 */

interface Stats { fps: number; visible: number; total: number }

async function readStats(page: import('@playwright/test').Page): Promise<Stats> {
  const text = (await page
    .locator('div')
    .filter({ hasText: /fps/ })
    .first()
    .textContent()) ?? ''
  const fps = Number(/(\d+)\s*fps/.exec(text)?.[1] ?? 0)
  const m = /visible\s+(\d+)\/(\d+)\s+nodes/.exec(text)
  return { fps, visible: Number(m?.[1] ?? 0), total: Number(m?.[2] ?? 0) }
}

test('Stage 1: spawn 2000 loads model and renders culled subset', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Spawn 2000' }).click()
  await page.waitForTimeout(800)

  const initial = await readStats(page)
  expect(initial.total).toBe(2000)
  expect(initial.visible).toBeGreaterThan(0)
  expect(initial.visible).toBeLessThan(initial.total)
  expect(initial.fps).toBeGreaterThan(0)
})

test('Stage 1: pan keeps the renderer ticking', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Spawn 2000' }).click()
  await page.waitForTimeout(500)

  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(cx + i * 12, cy + i * 6, { steps: 3 })
    await page.waitForTimeout(60)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)

  const after = await readStats(page)
  expect(after.fps).toBeGreaterThan(0)
  expect(after.total).toBe(2000)
})
