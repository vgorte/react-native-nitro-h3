import { useEffect, useRef } from 'react'

/**
 * Frees what a component held before, once React has committed what it holds now.
 *
 * A Skia picture or path is a native buffer behind a JSI object, so dropping the last reference
 * leaves the memory standing until the garbage collector reaches the wrapper. The outgoing value
 * is still in the drawn tree until the commit, so it is freed a render later rather than where it
 * was replaced, and the last one goes when the component does.
 *
 * @param held What the component holds now, a fresh object whenever it changes.
 * @param dispose Frees one value, called at most once per value; it has to be stable.
 */
export function useDisposed<T>(held: T, dispose: (value: T) => void): void {
  const previous = useRef(held)

  useEffect(() => {
    if (previous.current === held) return
    dispose(previous.current)
    previous.current = held
  }, [held, dispose])

  useEffect(() => {
    const last = previous
    return () => dispose(last.current)
  }, [dispose])
}

/**
 * Frees the members a list has dropped, for a component that carries some of them over.
 *
 * Identity is what says whether a member was kept, so a rebuilt member is freed and a reused one
 * is not. Every member left goes when the component does.
 *
 * @param held The list the component holds now.
 * @param dispose Frees one member, called at most once per member; it has to be stable.
 */
export function useDisposedList<T>(held: readonly T[], dispose: (value: T) => void): void {
  const previous = useRef(held)

  useEffect(() => {
    if (previous.current === held) return
    const kept = new Set(held)
    for (const value of previous.current) if (!kept.has(value)) dispose(value)
    previous.current = held
  }, [held, dispose])

  useEffect(() => {
    const last = previous
    return () => {
      for (const value of last.current) dispose(value)
    }
  }, [dispose])
}
