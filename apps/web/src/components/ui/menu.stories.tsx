import preview from '#storybook/preview'
import { MoreHorizontal } from 'lucide-react'
import { expect, fn, screen, waitFor } from 'storybook/test'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from './menu.tsx'

function TrackMenu({ onSelect }: { onSelect: (action: string) => void }) {
  return (
    <MenuRoot>
      <MenuTrigger aria-label="Track actions">
        <MoreHorizontal aria-hidden className="size-5" />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuItem onClick={() => onSelect('add')}>Add to playlist</MenuItem>
        <MenuItem onClick={() => onSelect('artist')}>Go to artist</MenuItem>
        <MenuSeparator />
        <MenuItem disabled>Remove from playlist</MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}

const meta = preview.meta({
  component: TrackMenu,
  args: { onSelect: fn() },
  parameters: { layout: 'centered' },
})

export const Default = meta.story({})

export const SelectsAnItem = meta.story({
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Track actions' }))
    // The popup renders in a portal, outside the story canvas.
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to playlist' }))
    await expect(args.onSelect).toHaveBeenCalledWith('add')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  },
})
