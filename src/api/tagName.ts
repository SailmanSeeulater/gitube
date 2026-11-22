/** A tag name the map can show: 1 to 100 characters, no control characters. Shown only as text. */
export function isTagName(name: unknown): name is string {
  // eslint-disable-next-line no-control-regex
  return typeof name === 'string' && name.length > 0 && name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(name)
}
