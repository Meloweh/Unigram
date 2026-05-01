import { expect, test } from '@playwright/test'

test('home page mounts the Omnigram shell with toolbar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Spawn 2000' })).toBeVisible()
  // Pixi canvas mounted into the host div.
  await expect(page.locator('canvas')).toBeVisible()
})
