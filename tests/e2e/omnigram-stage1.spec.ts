import { expect, test } from '@playwright/test'

async function openNewDiagram(page: import('@playwright/test').Page, title: string) {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Search diagrams' }).fill(title)
  await page.getByRole('button', { name: /\+ New/ }).click()
  const setup = page.getByRole('dialog', { name: 'New graph setup' })
  await expect(setup).toBeVisible()
  await setup.getByLabel('Topic').fill(`${title} topic`)
  await setup.getByLabel('Project description').fill(`Discussion space for ${title}.`)
  await setup.getByRole('button', { name: 'Create graph' }).click()
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
  await expect(page.getByRole('button', { name: 'Open forum' })).toBeVisible()
})

test('forum curtain creates a pending graph proposal without React graph overlays', async ({ page }) => {
  await openNewDiagram(page, `Forum proposal ${Date.now()}`)
  await page.getByRole('button', { name: 'Open forum' }).click()
  await expect(page.getByLabel('Forum reference selector')).toBeVisible()
  await page.getByRole('button', { name: 'Post' }).click()
  const account = page.getByLabel('Account login')
  await account.getByRole('button', { name: 'Register' }).click()
  await account.getByLabel('Username').fill(`Ada_${Date.now()}`)
  await account.getByLabel('Password').fill('diagram-password')
  await account.getByRole('button', { name: 'Create account' }).click()
  const form = page.getByLabel('Create forum post')
  await form.getByLabel('Title').fill('Suggest a branch')
  await form.getByLabel('Description').fill('Add a new connected idea.')
  await form.getByLabel('Suggest diagram change').check()
  await expect(form.getByLabel('Suggested action')).toHaveValue('add-node')
  await form.getByLabel('New name').fill('Alpha')
  await form.getByRole('button', { name: 'Post', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Suggest a branch' })).toBeVisible()
  await expect(page.locator('.social-proposal-overlay')).toHaveCount(0)
  await page.getByRole('button', { name: /view graph/i }).click()
  await expect(page.locator('canvas')).toBeVisible()
})
