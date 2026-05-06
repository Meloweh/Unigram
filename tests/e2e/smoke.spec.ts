import { expect, test } from '@playwright/test'

test('home page mounts the social diagram search', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Search diagrams' })).toBeVisible()
  await expect(page.getByRole('button', { name: /\+ New/ })).toBeVisible()
  await expect(page.getByLabel('Future suggestions')).toBeVisible()
})
