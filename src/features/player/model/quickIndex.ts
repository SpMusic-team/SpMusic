export function quickIndexKey(name: string): string {
  const trimmed = name.trimStart()
  const firstCode = trimmed.charCodeAt(0)
  if (firstCode >= 65 && firstCode <= 90) return trimmed.charAt(0)
  if (firstCode >= 97 && firstCode <= 122) return String.fromCharCode(firstCode - 32)
  if (firstCode >= 48 && firstCode <= 64) return '0'
  if (firstCode >= 33 && firstCode <= 47) return 'top'
  return '#'
}

export function compareByQuickIndex(left: string, right: string): number {
  const leftKey = quickIndexKey(left)
  const rightKey = quickIndexKey(right)
  const order = (key: string) => key === 'top' ? -1 : key === '0' ? 0 : key === '#' ? 27 : key.charCodeAt(0) - 64
  const group = order(leftKey) - order(rightKey)
  if (!group && leftKey === 'top') {
    const leftName = left.trimStart()
    const rightName = right.trimStart()
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0
  }
  if (!group && leftKey === '0') {
    const leftCode = left.trimStart().charCodeAt(0)
    const rightCode = right.trimStart().charCodeAt(0)
    const leftIsDigit = leftCode <= 57
    const rightIsDigit = rightCode <= 57
    if (leftIsDigit !== rightIsDigit) return leftIsDigit ? -1 : 1
  }
  if (!group && leftKey === '#') {
    const leftCode = left.trimStart().charCodeAt(0)
    const rightCode = right.trimStart().charCodeAt(0)
    const leftIsAscii = leftCode <= 127
    const rightIsAscii = rightCode <= 127
    if (leftIsAscii !== rightIsAscii) return leftIsAscii ? -1 : 1
  }
  return group || left.localeCompare(right, undefined, { numeric: true })
}
