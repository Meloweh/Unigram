import { expect, test } from '@playwright/test'

test('home page shows viewport with debug overlay', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Selection:')).toBeVisible()
})
