import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from 'cn'
import { GripVertical } from 'lucide-react'
import { useState, type ReactNode } from 'react'

/** How long a finger rests on a row before it lifts: shorter is a swipe or a scroll. */
export const TOUCH_HOLD_MS = 300

/**
 * A list whose rows drag into a new order: with the mouse (after a few pixels, so clicks still
 * click), by pressing and holding on a touch screen (so swiping and scrolling work as before), or
 * from the keyboard on each row's grip (Space to lift, arrows to move, Space to drop). The new
 * order shows at once and holds until `items` changes (the saved order coming back).
 *
 * `renderItem` gets each row's grip, to put where the row has room for it (a track row's `lead`).
 * With `disabled` nothing drags and no grip shows.
 */
export function SortableList<T>({
  items,
  getId,
  getLabel,
  onMove,
  renderItem,
  disabled = false,
  className,
  itemClassName,
  isMarked,
  canMove,
  ...props
}: {
  items: T[]
  getId: (item: T) => string
  /** What the row is, for its grip's label: "Move {label}". */
  getLabel: (item: T) => string
  /** A drop: `item` now sits where `target` was. A rejected promise puts the rows back. */
  onMove: (item: T, target: T) => unknown
  renderItem: (item: T, grip: ReactNode) => ReactNode
  disabled?: boolean
  className?: string
  itemClassName?: string
  /** Marks a row with `data-marked` (a row opened from a link, for a moment). */
  isMarked?: (item: T) => boolean
  /** Rows that stay put: they don't drag, get no grip, and others don't land on them. */
  canMove?: (item: T) => boolean
  'aria-busy'?: boolean
}) {
  // The dropped order, until the saved one arrives (`items` with other ids) or saving fails.
  const itemIds = items.map(getId).join('\n')
  const [dropped, setDropped] = useState<{ of: string; order: T[] } | null>(null)
  const shown = dropped?.of === itemIds ? dropped.order : items
  const ids = shown.map(getId)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TOUCH_HOLD_MS, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    // The release would also click whatever is under it (a link, the play button): not this time.
    const swallow = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    setDropped({ of: itemIds, order: arrayMove(shown, from, to) })
    Promise.resolve(onMove(shown[from]!, shown[to]!)).catch(() => setDropped(null))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ol className={className} aria-busy={props['aria-busy']}>
          {shown.map((item) => (
            <SortableItem
              key={getId(item)}
              id={getId(item)}
              label={getLabel(item)}
              disabled={disabled || canMove?.(item) === false}
              className={itemClassName} marked={isMarked?.(item)}>
              {(grip) => renderItem(item, grip)}
            </SortableItem>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function SortableItem({
  id,
  label,
  disabled,
  className,
  marked,
  children,
}: {
  id: string
  label: string
  disabled: boolean
  className?: string
  marked?: boolean
  children: (grip: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  // The pointer starts a drag anywhere on the row; the keyboard only from the grip, so Enter and
  // Space still work on the row's own links and buttons.
  const { onKeyDown, ...pointer } = (listeners ?? {}) as Record<string, (event: unknown) => void>
  const grip = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      onKeyDown={onKeyDown}
      aria-label={`Move ${label}`}
      title="Drag to move (press and hold on a touch screen)"
      className="-ml-1 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
    >
      <GripVertical aria-hidden className="size-4" />
    </button>
  )
  return (
    <li
      ref={setNodeRef}
      data-marked={marked || undefined}
      {...(disabled ? {} : pointer)}
      // No browser drag of the row's links and images: this list does the dragging.
      onDragStart={(event) => event.preventDefault()}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        className,
        // A held finger shouldn't select text or open the link menu.
        !disabled && 'touch-manipulation select-none [-webkit-touch-callout:none]',
        isDragging && 'relative z-10 rounded-lg bg-card shadow-lg ring-1 ring-border',
      )}
    >
      {children(grip)}
    </li>
  )
}
