export const namedHandler = (): { named: boolean } => ({ named: true })

export function functionHandler(): { fromFunction: boolean } {
  return { fromFunction: true }
}

export default (): { fromDefault: boolean } => ({ fromDefault: true })
