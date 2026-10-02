import preview from '#storybook/preview'
import type { PageSize } from '@replay-crate/core'
import { createMemoryHistory, createRootRoute, createRouter, Link, RouterProvider } from '@tanstack/react-router'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { ListPagination } from './list-pagination.tsx'

const meta = preview.meta({
  title: 'ListPagination',
  component: ListPagination,
  args: {
    page: 1,
    size: 20 as PageSize,
    total: 1234 as number | undefined,
    onSizeChange: fn(),
    linkTo: (page: number) => <Link to="/" search={{ page }} />,
  },
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
})

export const FirstPage = meta.story({
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('1–20 of 1,234')).toBeVisible()
    const pages = within(canvas.getByRole('navigation', { name: 'Pages' }))
    await expect(pages.getByRole('link', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    await expect(pages.getByRole('link', { name: 'Page 62' })).toBeVisible()
    // Nowhere further back to go.
    await expect(pages.queryByRole('link', { name: 'Previous page' })).toBeNull()
    await expect(pages.queryByRole('link', { name: 'First page' })).toBeNull()
    await expect(pages.getByRole('link', { name: 'Last page' })).toHaveAttribute('href', '/?page=62')
    await expect(pages.getByText('More pages')).toBeInTheDocument()
  },
})

export const MiddlePage = meta.story({
  args: { page: 30 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('581–600 of 1,234')).toBeVisible()
    const pages = within(canvas.getByRole('navigation', { name: 'Pages' }))
    // First, neighbours, last, with an ellipsis either side.
    for (const page of [1, 29, 30, 31, 62]) await expect(pages.getByRole('link', { name: `Page ${page}` })).toBeVisible()
    await expect(pages.getAllByText('More pages')).toHaveLength(2)
    await expect(pages.getByRole('link', { name: 'First page' })).toHaveAttribute('href', '/?page=1')
    await expect(pages.getByRole('link', { name: 'Last page' })).toHaveAttribute('href', '/?page=62')
  },
})

export const LastPage = meta.story({
  args: { page: 62 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('1,221–1,234 of 1,234')).toBeVisible()
    const pages = within(canvas.getByRole('navigation', { name: 'Pages' }))
    await expect(pages.queryByRole('link', { name: 'Next page' })).toBeNull()
    await expect(pages.queryByRole('link', { name: 'Last page' })).toBeNull()
    await expect(pages.getByRole('link', { name: 'First page' })).toHaveAttribute('href', '/?page=1')
  },
})

export const OnePage = meta.story({
  args: { total: 7 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('1–7 of 7')).toBeVisible()
    await expect(canvas.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  },
})

/** All: just the size picker; the list shows its own "Load more". */
export const All = meta.story({
  args: { size: 'all', total: undefined },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('combobox', { name: 'Per page' })).toHaveTextContent('All')
    await expect(canvas.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  },
})

export const PicksASize = meta.story({
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Per page' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    await expect(options).toEqual(['5', '10', '15', '20', '25', '30', 'All'])
    await userEvent.click(screen.getByRole('option', { name: '5' }))
    await expect(args.onSizeChange).toHaveBeenCalledWith(5)
    // The a11y check runs once the story ends: let the list finish closing first.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  },
})

export const Phone = meta.story({
  args: { page: 3 },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Page 3 of 62')).toBeVisible()
    // The numbers are hidden on a phone, so first and last are the way to the ends.
    const pages = within(canvas.getByRole('navigation', { name: 'Pages' }))
    await expect(pages.getByRole('link', { name: 'First page' })).toBeVisible()
    await expect(pages.getByRole('link', { name: 'Last page' })).toBeVisible()
  },
})
