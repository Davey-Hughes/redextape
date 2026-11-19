/**
 * A program's labels: each name, with the index of the item it stands above, or the count of items for a label that
 * follows the last one.
 */
export type Labels = readonly (readonly [string, number])[]

/**
 * Walks `count` items and their labels in the order they are drawn, calling `label` and `item` for each.
 *
 * **AN ITEM'S LABELS COME FIRST, IN `labels` ORDER, AS `print_rxm` PRINTS THEM.** A label one past the last item is
 * printed after it, and so drawn after it; a label further out has no place and is dropped.
 */
export function placeLabels(
  count: number,
  labels: Labels,
  label: (name: string) => void,
  item: (index: number) => void,
): void {
  const at = new Map<number, string[]>()
  for (const [name, index] of labels) at.set(index, [...(at.get(index) ?? []), name])
  for (let i = 0; i <= count; i += 1) {
    for (const name of at.get(i) ?? []) label(name)
    if (i < count) item(i)
  }
}
