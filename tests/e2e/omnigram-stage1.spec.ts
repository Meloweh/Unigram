import { expect, test } from '@playwright/test'

async function openNewDiagram(page: import('@playwright/test').Page, title: string) {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Search diagrams' }).fill(title)
  await page.getByRole('button', { name: /\+ New/ }).click()
  await expect(page.locator('canvas')).toBeVisible()
}

test('diagram selection opens the canvas view and autosaves', async ({ page }) => {
  await openNewDiagram(page, `E2E diagram ${Date.now()}`)
  await expect(page.getByRole('toolbar', { name: 'Editor toolbar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cloud Save' })).toHaveCount(0)
  await expect(page.getByText(/\d+ fps\s+·\s+visible/)).toBeVisible()
  await page.waitForResponse((response) =>
    response.url().includes('/api/diagrams/') &&
    response.request().method() === 'PUT' &&
    response.ok(),
  )
})

test('social diagram view hides sidebars and debug spawn controls', async ({ page }) => {
  await openNewDiagram(page, `Chrome hidden ${Date.now()}`)
  await expect(page.getByRole('button', { name: 'Spawn 2000' })).toHaveCount(0)
  await expect(page.getByText('Add Node')).toHaveCount(0)
  await expect(page.getByText('Inspector')).toHaveCount(0)
})
