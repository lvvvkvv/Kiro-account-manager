import type { ReactNode } from 'react'
import type { Account } from '@/types/account'
import { VirtualRows } from '../ui/VirtualRows'

/** Preserve the chip layout for small groups and bound large assignment lists. */
export function AccountAssignmentList({
  items,
  renderItem
}: {
  items: Account[]
  renderItem: (account: Account) => ReactNode
}): ReactNode {
  if (items.length < 50) return <div className="flex flex-wrap gap-1">{items.map(renderItem)}</div>
  return (
    <VirtualRows
      items={items}
      estimateSize={26}
      maxHeight="8rem"
      renderRow={(item) => <div className="py-0.5">{renderItem(item)}</div>}
    />
  )
}
