import { useRef, type ReactNode, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/** Keep small lists natural-height and bound DOM work for large lists. */
export function VirtualRows<T extends { accountId?: string; id?: string }>({
  items,
  renderRow,
  scrollRef,
  estimateSize = 48,
  maxHeight = '60vh'
}: {
  items: T[]
  renderRow: (item: T, index: number) => ReactNode
  scrollRef?: RefObject<HTMLDivElement | null>
  estimateSize?: number
  maxHeight?: string
}): ReactNode {
  const parent = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => estimateSize,
    overscan: 10,
    getItemKey: (index) => items[index].id || items[index].accountId || index
  })
  return (
    <div
      ref={(node) => {
        parent.current = node
        if (scrollRef) scrollRef.current = node
      }}
      style={{
        maxHeight,
        height: items.length >= 50 ? maxHeight : undefined,
        overflowY: 'auto'
      }}
    >
      {items.length < 50 ? (
        items.map(renderRow)
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`
              }}
            >
              {renderRow(items[row.index], row.index)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
