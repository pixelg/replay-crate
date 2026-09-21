export const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })

/** "1 play", "12,345 plays". */
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
