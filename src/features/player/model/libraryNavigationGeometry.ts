// Read layout coordinates without Motion's temporary projection/exit matrices.
export function readLibraryLayoutRect(element: HTMLElement): DOMRect {
  let x = 0
  let y = 0
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft
    y += node.offsetTop
  }
  for (let node = element.parentElement; node; node = node.parentElement) {
    x -= node.scrollLeft
    y -= node.scrollTop
  }
  return new DOMRect(x, y, element.offsetWidth, element.offsetHeight)
}
